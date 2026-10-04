const { AppError } = require('../../utils/errors');
const { postJson } = require('./http');

function createOpenAIProvider(cfg) {
  if (!cfg.openaiKey) {
    throw new AppError(503, 'AI_NOT_CONFIGURED', 'OPENAI_API_KEY is not set on the server. Set it, or use AI_PROVIDER=mock for the offline demo planner.');
  }
  const toNative = (m) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } })),
      };
    }
    return { role: m.role, content: m.content };
  };
  return {
    label: `openai:${cfg.openaiModel}`,
    async chat({ messages, tools }) {
      const data = await postJson(
        'https://api.openai.com/v1/chat/completions',
        { authorization: `Bearer ${cfg.openaiKey}` },
        {
          model: cfg.openaiModel,
          messages: messages.map(toNative),
          tools: tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters || { type: 'object', properties: {} } },
          })),
        },
        { timeoutMs: cfg.timeoutMs, secrets: [cfg.openaiKey], provider: 'OpenAI' }
      );
      const msg = data.choices && data.choices[0] && data.choices[0].message;
      if (!msg) throw new AppError(502, 'AI_PROVIDER_ERROR', 'OpenAI returned no message.');
      const toolCalls = (msg.tool_calls || []).map((c) => {
        let args = {};
        try { args = JSON.parse(c.function.arguments || '{}'); } catch { args = {}; }
        return { id: c.id, name: c.function.name, args };
      });
      return { content: msg.content || '', toolCalls };
    },
  };
}

module.exports = { createOpenAIProvider };
