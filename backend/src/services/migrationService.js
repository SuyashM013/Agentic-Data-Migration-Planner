const { Migration, MigrationExecution } = require('../models');
const { STATUS, EVENT } = require('../constants');
const { getConfig } = require('../config');
const { validateMigrationInput } = require('../engine/inputValidation');
const { notFound } = require('../utils/errors');
const { assertObjectId } = require('./stateMachine');
const { computeReconciliation } = require('./reconciliationService');
const { recordEvent, listEvents } = require('./eventService');

async function createMigration(body) {
  const cfg = getConfig();
  const input = validateMigrationInput(body, cfg.maxSampleRecords);
  const migration = await Migration.create({
    ...input,
    sampleCount: input.sampleRecords.length,
    status: STATUS.DRAFT,
  });
  await recordEvent(migration._id, EVENT.CREATED, {
    message: `Migration "${migration.name}" created with ${migration.sampleCount} sample records.`,
    metadata: { sampleCount: migration.sampleCount },
  });
  return migration.toObject();
}

async function listMigrations() {
  const items = await Migration.find({}, { sampleRecords: 0, plans: 0, sourceSchema: 0, targetSchema: 0 }).sort({ createdAt: -1 }).lean();
  const count = (fn) => items.filter(fn).length;
  const stats = {
    total: items.length,
    draft: count((m) => m.status === STATUS.DRAFT),
    pendingApproval: count((m) => m.status === STATUS.PLAN_READY),
    successful: count((m) => m.status === STATUS.COMPLETED),
    rolledBack: count((m) => m.status === STATUS.ROLLED_BACK),
  };
  return { items, stats };
}

async function getMigration(id) {
  assertObjectId(id);
  const migration = await Migration.findById(id).lean();
  if (!migration) throw notFound('Migration not found');
  return migration;
}

/** Full detail for the workbench UI: migration + all dry-run/execution records (newest first). */
async function getMigrationDetail(id) {
  const migration = await getMigration(id);
  const executions = await MigrationExecution.find({ migrationId: migration._id }).sort({ createdAt: -1 }).lean();
  const reconciliation = await computeReconciliation(migration);
  return { ...migration, executions, reconciliation };
}

async function getHistory(id) {
  const migration = await getMigration(id);
  const events = await listEvents(migration._id);
  return {
    events,
    planVersions: migration.plans.map((p) => ({
      version: p.version,
      createdBy: p.createdBy,
      createdByLabel: p.createdByLabel,
      createdAt: p.createdAt,
      status: p.status,
      approvedBy: p.approvedBy,
      approvedAt: p.approvedAt,
      mappingCount: p.mappings.length,
    })),
  };
}

module.exports = { createMigration, listMigrations, getMigration, getMigrationDetail, getHistory };
