const express = require('express');
const cors = require('cors');
const { getConfig } = require('./config');
const { AppError } = require('./utils/errors');
const logger = require('./utils/logger');
const migrationRoutes = require('./routes/migrationRoutes');
const ctrl = require('./controllers/migrationController');
const app = express();

function createApp() {
  const cfg = getConfig();
  app.disable('x-powered-by');
  app.use(cors({ origin: cfg.corsOrigin === '*' ? true : cfg.corsOrigin.split(',').map((s) => s.trim()) }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/', (req, res) => res.json({ message: 'Welcome to the Data Migration API - ALL GOOD ' }));
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.get('/api/config', ctrl.config);
  app.get('/api/demo-data', ctrl.demoData);
  app.use('/api/migrations', migrationRoutes);

  app.use('/api', (req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' } });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } });
    }
    if (err.name === 'CastError' || err.name === 'ValidationError') {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err.message } });
    }
    logger.error('unhandled_error', { message: err.message, stack: err.stack });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' } });
  });

  return app;
}

module.exports = { createApp };
