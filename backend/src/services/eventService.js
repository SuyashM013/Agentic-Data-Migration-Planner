const { MigrationEvent } = require('../models');
const logger = require('../utils/logger');

/** Persists an immutable history event and emits a structured log line (secrets redacted). */
async function recordEvent(migrationId, type, { message = '', actor = 'system', planVersion = null, executionId = null, metadata = {} } = {}) {
  const event = await MigrationEvent.create({ migrationId, type, message, actor, planVersion, executionId, metadata });
  logger.info(type, { migrationId: String(migrationId), planVersion, executionId, actor, ...metadata });
  return event;
}

async function listEvents(migrationId) {
  return MigrationEvent.find({ migrationId }).sort({ createdAt: 1, _id: 1 }).lean();
}

module.exports = { recordEvent, listEvents };
