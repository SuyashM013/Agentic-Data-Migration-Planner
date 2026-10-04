const { QuarantineRecord, TargetRecord } = require('../models');
const { getMigration } = require('./migrationService');

async function listQuarantine(id) {
  const migration = await getMigration(id);
  const items = await QuarantineRecord.find({ migrationId: migration._id }).sort({ rowIndex: 1 }).lean();
  return { total: items.length, items };
}

async function listTargetRecords(id, limit = 200) {
  const migration = await getMigration(id);
  const [total, items] = await Promise.all([
    TargetRecord.countDocuments({ migrationId: migration._id }),
    TargetRecord.find({ migrationId: migration._id }).sort({ _id: 1 }).limit(limit).lean(),
  ]);
  return { total, items };
}

module.exports = { listQuarantine, listTargetRecords };
