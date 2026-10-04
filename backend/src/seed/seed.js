// Usage: npm run seed   (creates the two demo migrations in DRAFT state; open the UI and click "Analyze with AI")
const { getConfig } = require('../config');
const { connectDb } = require('../db');
const { ensureIndexes } = require('../models/ensureIndexes');
const { createMigration } = require('../services/migrationService');
const { buildDemoDatasets } = require('./demoData');

(async () => {
  await connectDb(getConfig().mongoUri);
  await ensureIndexes();
  const { full, mini } = buildDemoDatasets();
  for (const d of [full, mini]) {
    const m = await createMigration({ name: d.name, sourceSchema: d.sourceSchema, targetSchema: d.targetSchema, sampleRecords: d.sampleRecords });
    console.log(`Created "${m.name}" -> id ${m._id}`);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
