require('dotenv').config();

const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

// Read lazily so tests can change process.env before calling.
function getConfig() {
  return {
    port: int(process.env.PORT, 5000),
    mongoUri: process.env.MONGODB_URI,
    //  'mongodb://127.0.0.1:27017/migration_workbench',
    corsOrigin: process.env.CORS_ORIGIN || '*',
    maxSampleRecords: int(process.env.MAX_SAMPLE_RECORDS, 100),
    ai: {
      provider: (process.env.AI_PROVIDER),
      // openaiKey: process.env.OPENAI_API_KEY || '',
      // openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      geminiKey: process.env.GEMINI_API_KEY,
      geminiModel: process.env.GEMINI_MODEL ,
      timeoutMs: int(process.env.AI_TIMEOUT_MS, 60000),
    },
  };
}

module.exports = { getConfig };
