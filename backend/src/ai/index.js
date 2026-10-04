const { getConfig } = require('../config');
const { AppError } = require('../utils/errors');
const { createOpenAIProvider } = require('./providers/openai');
const { createGeminiProvider } = require('./providers/gemini');
const { createMockProvider } = require('./providers/mock');

/** Builds the configured provider. Keys are read from server env only and never leave the backend. */
function getProvider(overrideCfg) {
  const ai = overrideCfg || getConfig().ai;
  switch (ai.provider) {
    case 'openai': return createOpenAIProvider(ai);
    case 'gemini': return createGeminiProvider(ai);
    case 'mock': return createMockProvider(ai);
    default: throw new AppError(503, 'AI_NOT_CONFIGURED', `Unknown AI_PROVIDER "${ai.provider}". Use openai, gemini or mock.`);
  }
}

module.exports = { getProvider };
