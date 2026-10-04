const { MigrationExecution, TargetRecord, QuarantineRecord } = require('../models');
const { STATUS } = require('../constants');

/**
 * Compares what the approved plan said should land in the target with what is actually in the target store.
 * Pure read: computed live from the collections, so it can never drift from reality.
 */
async function computeReconciliation(migration) {
  const id = migration._id;
  const executions = await MigrationExecution.find({ migrationId: id, type: 'EXECUTION', status: { $in: ['COMPLETED', 'ROLLED_BACK'] } }).sort({ createdAt: 1 }).lean();
  if (executions.length === 0) {
    return { state: 'NOT_EXECUTED', passed: null, expected: null, inserted: 0, difference: null, checks: [] };
  }
  const rolledBack = migration.status === STATUS.ROLLED_BACK;
  const first = executions[0];
  const [targetCount, quarantinedCount] = await Promise.all([
    TargetRecord.countDocuments({ migrationId: id }),
    QuarantineRecord.countDocuments({ migrationId: id }),
  ]);

  const liveExecutions = executions.filter((e) => e.status === 'COMPLETED');
  const insertedByExecutions = liveExecutions.reduce((n, e) => n + e.insertedCount, 0);
  const expected = rolledBack ? 0 : first.acceptedCount;

  const checks = [
    { name: 'Target count equals accepted count', passed: targetCount === expected, detail: `expected ${expected}, target store holds ${targetCount}` },
    { name: 'Source = accepted + rejected', passed: first.sourceCount === first.acceptedCount + first.rejectedCount, detail: `${first.sourceCount} = ${first.acceptedCount} + ${first.rejectedCount}` },
    { name: 'Every rejected record is quarantined', passed: quarantinedCount === first.rejectedCount, detail: `${first.rejectedCount} rejected, ${quarantinedCount} in quarantine` },
    { name: 'Inserted total matches target store', passed: insertedByExecutions === targetCount, detail: `executions inserted ${insertedByExecutions}, target store holds ${targetCount}` },
  ];
  const passed = checks.every((c) => c.passed);
  return {
    state: rolledBack ? (passed ? 'ROLLED_BACK' : 'FAILED') : passed ? 'PASSED' : 'FAILED',
    passed,
    sourceCount: first.sourceCount,
    acceptedCount: first.acceptedCount,
    rejectedCount: first.rejectedCount,
    quarantinedCount,
    expected,
    inserted: targetCount,
    difference: expected - targetCount,
    duplicatesSkipped: liveExecutions.reduce((n, e) => n + e.duplicateCount, 0),
    checks,
  };
}

module.exports = { computeReconciliation };
