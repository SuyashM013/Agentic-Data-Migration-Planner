const crypto = require('crypto');
const { MigrationExecution } = require('../models');
const { STATUS, EVENT } = require('../constants');
const { transition } = require('./stateMachine');
const { recordEvent } = require('./eventService');
const { getMigration } = require('./migrationService');
const { processRecords } = require('../engine/transformRecord');
const { inputHash } = require('../engine/hash');
const { conflict } = require('../utils/errors');

/** Loads the approved plan or throws. Shared by dry run and execution so both enforce the same approval gate. */
function requireApprovedPlan(migration) {
  const plan = migration.plans.find((p) => p.version === migration.approvedPlanVersion && p.status === 'APPROVED');
  if (!plan || !migration.approval || !migration.approval.approvedAt) {
    throw conflict('This migration has no approved plan. A human must approve the plan first.', 'PLAN_NOT_APPROVED');
  }
  return plan;
}

/**
 * Deterministic dry run: transform + validate every sample record with the approved plan. No LLM, no target writes.
 * Persists the result (accepted preview + rejected records with field-level errors) as a DRY_RUN execution document.
 */
async function runDryRun(id) {
  const migration = await getMigration(id);
  if (![STATUS.APPROVED, STATUS.DRY_RUN_COMPLETED].includes(migration.status)) {
    throw conflict(`A dry run requires an approved plan (current status: ${migration.status}).`, migration.status === STATUS.PLAN_READY ? 'PLAN_NOT_APPROVED' : 'INVALID_STATE', { currentStatus: migration.status });
  }
  const plan = requireApprovedPlan(migration);
  await recordEvent(id, EVENT.DRY_RUN_STARTED, { planVersion: plan.version, message: `Dry run started for plan v${plan.version}.` });

  const result = processRecords(migration.sampleRecords, plan, migration.targetSchema);
  const hash = inputHash({ records: migration.sampleRecords, targetSchema: migration.targetSchema, mappings: plan.mappings });

  await transition(id, [STATUS.APPROVED, STATUS.DRY_RUN_COMPLETED], STATUS.DRY_RUN_COMPLETED, {}, {}, { approvedPlanVersion: plan.version });
  const dryRun = await MigrationExecution.create({
    migrationId: id,
    executionId: crypto.randomUUID(),
    type: 'DRY_RUN',
    planVersion: plan.version,
    status: 'COMPLETED',
    inputHash: hash,
    sourceCount: result.sourceCount,
    transformedCount: result.transformedCount,
    acceptedCount: result.accepted.length,
    rejectedCount: result.rejected.length,
    acceptedRecords: result.accepted,
    rejectedRecords: result.rejected,
    completedAt: new Date(),
  });
  await recordEvent(id, EVENT.DRY_RUN_COMPLETED, {
    planVersion: plan.version,
    executionId: dryRun.executionId,
    message: `Dry run completed: ${result.sourceCount} source, ${result.transformedCount} transformed, ${result.accepted.length} accepted, ${result.rejected.length} rejected.`,
    metadata: { source: result.sourceCount, transformed: result.transformedCount, accepted: result.accepted.length, rejected: result.rejected.length },
  });
  return dryRun.toObject();
}

module.exports = { runDryRun, requireApprovedPlan };
