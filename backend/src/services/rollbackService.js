const { MigrationExecution, TargetRecord } = require('../models');
const { STATUS, EVENT } = require('../constants');
const { transition } = require('./stateMachine');
const { recordEvent } = require('./eventService');
const { getMigration } = require('./migrationService');
const { computeReconciliation } = require('./reconciliationService');
const { AppError, conflict } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * Removes ONLY records created by this migration's executions (matched by migrationId AND the preserved inserted ids /
 * executionIds). Quarantine records, executions and history are kept. Never a broad delete.
 */
async function rollbackMigration(id, { actor = 'user' } = {}) {
  const migration = await getMigration(id);
  if (migration.status === STATUS.ROLLED_BACK) {
    const remaining = await TargetRecord.countDocuments({ migrationId: id });
    if (remaining === 0) throw conflict('This migration has already been rolled back.', 'ALREADY_ROLLED_BACK');
    // else: a previous rollback was interrupted; allow re-running the cleanup
  } else if (migration.status !== STATUS.COMPLETED) {
    throw conflict(`Only a completed migration can be rolled back (current status: ${migration.status}).`, 'INVALID_STATE', { currentStatus: migration.status });
  }

  // Claim first so a concurrent retry/execute cannot interleave with the deletion.
  await transition(id, [STATUS.COMPLETED, STATUS.ROLLED_BACK], STATUS.ROLLED_BACK);

  const executions = await MigrationExecution.find({ migrationId: id, type: 'EXECUTION', status: { $in: ['COMPLETED', 'ROLLED_BACK'] } }).lean();
  const targetIds = executions.flatMap((e) => e.insertedTargetIds);
  const executionIds = executions.map((e) => e.executionId);

  try {
    const res = await TargetRecord.deleteMany({
      migrationId: id,
      $or: [{ _id: { $in: targetIds } }, { executionId: { $in: executionIds } }],
    });
    const remaining = await TargetRecord.countDocuments({ migrationId: id });
    if (remaining > 0) throw new Error(`${remaining} target record(s) still present after rollback`);
    await MigrationExecution.updateMany({ migrationId: id, type: 'EXECUTION', status: 'COMPLETED' }, { $set: { status: 'ROLLED_BACK', rolledBackAt: new Date() } });
    await recordEvent(id, EVENT.ROLLED_BACK, {
      actor: `user:${actor}`,
      planVersion: migration.approvedPlanVersion,
      message: `Rollback removed ${res.deletedCount} target records created by this migration. Quarantine records and history are preserved.`,
      metadata: { removed: res.deletedCount, executions: executionIds.length },
    });
    const fresh = await getMigration(id);
    return { migration: fresh, removed: res.deletedCount, reconciliation: await computeReconciliation(fresh) };
  } catch (err) {
    logger.error('rollback_error', { migrationId: String(id), message: err.message });
    await recordEvent(id, EVENT.FAILED, { message: 'Rollback did not finish. Run rollback again to complete the cleanup.', metadata: { error: err.message.slice(0, 300), phase: 'rollback' } });
    throw new AppError(500, 'ROLLBACK_FAILED', 'Rollback did not finish. Run rollback again to complete the cleanup.');
  }
}

module.exports = { rollbackMigration };
