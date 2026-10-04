const models = require('./index');

// Unique indexes (idempotency key etc.) must exist before the first write.
async function ensureIndexes() {
  await Promise.all(Object.values(models).map((m) => m.init()));
}

module.exports = { ensureIndexes };
