const { getConfig } = require('./config');
const { connectDb } = require('./db');
const { createApp } = require('./app');
const { ensureIndexes } = require('./models/ensureIndexes');
const logger = require('./utils/logger');

async function main() {
  const cfg = getConfig();
  await connectDb(cfg.mongoUri);
  await ensureIndexes();
  const app = createApp();

  app.listen(cfg.port, () => logger.info('server_listening', { port: cfg.port, aiProvider: cfg.ai.provider }));
}

main().catch((err) => {
  logger.error('startup_failed', { message: err.message });
  process.exit(1);
});
