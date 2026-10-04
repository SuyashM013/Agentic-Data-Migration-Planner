const crypto = require('crypto');
const { MigrationExecution, TargetRecord, QuarantineRecord } = require('../models');
const { STATUS, EVENT } = require('../constants');
const { transition } = require('./stateMachine');
const { recordEvent } = require('./eventService');
const { getMigration } = require('./migrationService');
const { requireApprovedPlan } = require('./dryRunService');
const { computeReconciliation } = require('./reconciliationService');
const { processRecords } = require('../engine/transformRecord');
const { inputHash } = require('../engine/hash');
const { AppError, conflict } = require('../utils/errors');
const logger = require('../utils/logger');

const DUPLICATE_KEY = 11000;

function assertExecutable(migration) {
  switch (migration.status) {
    case STATUS.DRY_RUN_COMPLETED:
    case STATUS.COMPLETED:
    case STATUS.FAILED:
      return;
    case STATUS.APPROVED:
      throw conflict('Run a dry run before executing. Execution requires a successful dry run of the approved plan.', 'DRY_RUN_REQUIRED');
    case STATUS.EXECUTING:
      throw conflict('This migration is already executing.', 'INVALID_STATE');
    case STATUS.ROLLED_BACK:
      throw conflict('This migration was rolled back and cannot be executed again. Create a new migration instead.', 'INVALID_STATE');
    default:
      throw conflict('This migration cannot execute until its plan is approved and a successful dry run exists.', 'PLAN_NOT_APPROVED', { currentStatus: migration.status });
  }
}

/**
 * Deterministic execution. Safety properties:
 *  - requires an approved plan AND a dry run of that exact plan + data (hash compared)
 *  - the backend re-runs the engine itself; it never trusts stored/AI output
 *  - every insert carries idempotencyKey = `${migrationId}:${sourceRecordId}` with a UNIQUE index, so retries cannot duplicate
 *  - on any error, records inserted by THIS execution are removed (scoped by executionId) and nothing else is touched
 */
async function executeMigration(id, { actor = 'user' } = {}) {
  const migration = await getMigration(id);
  assertExecutable(migration);
  const plan = requireApprovedPlan(migration);

  const dryRun = await MigrationExecution.findOne({ migrationId: id, type: 'DRY_RUN', status: 'COMPLETED', planVersion: plan.version }).sort({ createdAt: -1 }).lean();
  if (!dryRun) throw conflict('Run a dry run before executing. Execution requires a successful dry run of the approved plan.', 'DRY_RUN_REQUIRED');

  const hash = inputHash({ records: migration.sampleRecords, targetSchema: migration.targetSchema, mappings: plan.mappings });
  if (dryRun.inputHash !== hash) throw conflict('The data or plan changed since the last dry run. Run a new dry run.', 'DRY_RUN_STALE');

  const previousSuccess = await MigrationExecution.countDocuments({ migrationId: id, type: 'EXECUTION', status: 'COMPLETED', planVersion: plan.version });
  const isRetry = previousSuccess > 0;

  // Atomic claim: only one request can move the migration into EXECUTING.
  await transition(id, [STATUS.DRY_RUN_COMPLETED, STATUS.COMPLETED, STATUS.FAILED], STATUS.EXECUTING, { lastError: null }, {}, { approvedPlanVersion: plan.version });

  const result = processRecords(migration.sampleRecords, plan, migration.targetSchema);
  const execution = await MigrationExecution.create({
    migrationId: id,
    executionId: crypto.randomUUID(),
    type: 'EXECUTION',
    isRetry,
    planVersion: plan.version,
    status: 'RUNNING',
    inputHash: hash,
    sourceCount: result.sourceCount,
    transformedCount: result.transformedCount,
    acceptedCount: result.accepted.length,
    rejectedCount: result.rejected.length,
    rejectedRecords: result.rejected,
  });
  const { executionId } = execution;
  await recordEvent(id, isRetry ? EVENT.RETRIED : EVENT.STARTED, {
    actor: `user:${actor}`,
    planVersion: plan.version,
    executionId,
    message: isRetry
      ? `Retry started for plan v${plan.version}; already-inserted records will be skipped.`
      : `Execution started for plan v${plan.version}: ${result.accepted.length} accepted records to insert.`,
  });

  try {
    const insertedIds = [];
    let duplicates = 0;
    for (const { sourceRecordId, record } of result.accepted) {
      try {
        const doc = await TargetRecord.create({
          migrationId: id,
          executionId,
          planVersion: plan.version,
          idempotencyKey: `${id}:${sourceRecordId}`,
          sourceRecordId,
          data: record,
        });
        insertedIds.push(doc._id);
      } catch (e) {
        if (e && e.code === DUPLICATE_KEY) duplicates += 1; // already migrated by an earlier execution -> skip
        else throw e;
      }
    }

    // Quarantine is written once, by the first successful execution; retries would only duplicate the same rows.
    if (!isRetry && result.rejected.length) {
      await QuarantineRecord.insertMany(
        result.rejected.map((r) => ({
          migrationId: id,
          executionId,
          planVersion: plan.version,
          rowIndex: r.rowIndex,
          sourceRecordId: r.sourceRecordId,
          sourceRecord: r.sourceRecord,
          fieldErrors: r.fieldErrors,
        }))
      );
    }

    execution.set({ status: 'COMPLETED', insertedCount: insertedIds.length, duplicateCount: duplicates, insertedTargetIds: insertedIds, completedAt: new Date() });
    await execution.save();
    const completed = await transition(id, [STATUS.EXECUTING], STATUS.COMPLETED);
    execution.reconciliation = await computeReconciliation(completed.toObject());
    await execution.save();

    await recordEvent(id, EVENT.COMPLETED, {
      actor: `user:${actor}`,
      planVersion: plan.version,
      executionId,
      message: `${isRetry ? 'Retry' : 'Execution'} completed: ${insertedIds.length} inserted, ${duplicates} duplicates skipped, ${result.rejected.length} rejected.`,
      metadata: { inserted: insertedIds.length, duplicates, rejected: result.rejected.length, isRetry },
    });
    return (await MigrationExecution.findOne({ executionId }).lean());
  } catch (err) {
    logger.error('execution_error', { migrationId: String(id), executionId, message: err.message });
    // Compensate: remove only what THIS execution created.
    const removed = await TargetRecord.deleteMany({ migrationId: id, executionId });
    await QuarantineRecord.deleteMany({ migrationId: id, executionId });
    execution.set({ status: 'FAILED', error: err.message.slice(0, 500), insertedCount: 0, duplicateCount: 0, insertedTargetIds: [], completedAt: new Date() });
    await execution.save();
    // A failed retry must not mark already-migrated data as failed; the earlier success is intact.
    await transition(id, [STATUS.EXECUTING], isRetry ? STATUS.COMPLETED : STATUS.FAILED, { lastError: `Execution failed: ${err.message.slice(0, 300)}` });
    await recordEvent(id, EVENT.FAILED, {
      planVersion: plan.version,
      executionId,
      message: isRetry ? 'Retry failed. Previously migrated records are unchanged.' : 'Migration failed. No target records were inserted.',
      metadata: { error: err.message.slice(0, 300), compensatedRecords: removed.deletedCount, isRetry },
    });
    throw new AppError(500, 'EXECUTION_FAILED', isRetry ? 'Retry failed. Previously migrated records are unchanged.' : 'Migration failed. No target records were inserted.');
  }
}

module.exports = { executeMigration };
