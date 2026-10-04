const { AppError } = require('../../utils/errors');
const { postJson } = require('./http');

function createGeminiProvider(cfg) {
  if (!cfg.geminiKey) {
    throw new AppError(503, 'AI_NOT_CONFIGURED', 'GEMINI_API_KEY is not set on the server. Set it, or use AI_PROVIDER=mock for the offline demo planner.');
  }
  // Neutral -> Gemini contents. Raw model parts (incl. thought signatures) are replayed verbatim when present.
  function toContents(messages) {
    const contents = [];
    for (const m of messages) {
      if (m.role === 'system') continue;
      if (m.role === 'user') contents.push({ role: 'user', parts: [{ text: m.content }] });
      else if (m.role === 'assistant') {
        const parts = m.native || [
          ...(m.content ? [{ text: m.content }] : []),
          ...(m.toolCalls || []).map((c) => ({ functionCall: { name: c.name, args: c.args || {} } })),
        ];
        contents.push({ role: 'model', parts });
      } else if (m.role === 'tool') {
        let parsed;
        try { parsed = JSON.parse(m.content); } catch { parsed = { text: m.content }; }
        const part = { functionResponse: { name: m.name, response: { result: parsed } } };
        const last = contents[contents.length - 1];
        if (last && last.role === 'user' && last.parts.every((p) => p.functionResponse)) last.parts.push(part);
        else contents.push({ role: 'user', parts: [part] });
      }
    }
    return contents;
  }
  return {
    label: `gemini:${cfg.geminiModel}`,
    async chat({ messages, tools }) {
      const system = messages.find((m) => m.role === 'system');
      const data = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.geminiModel)}:generateContent`,
        { 'x-goog-api-key': cfg.geminiKey },
        {
          systemInstruction: system ? { parts: [{ text: system.content }] } : undefined,
          contents: toContents(messages),
          tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, ...(t.parameters ? { parameters: t.parameters } : {}) })) }],
        },
        { timeoutMs: cfg.timeoutMs, secrets: [cfg.geminiKey], provider: 'Gemini' }
      );
      const cand = data.candidates && data.candidates[0];
      const parts = cand && cand.content && cand.content.parts;
      if (!parts) throw new AppError(502, 'AI_PROVIDER_ERROR', `Gemini returned no content${cand && cand.finishReason ? ` (finishReason: ${cand.finishReason})` : ''}.`);
      const toolCalls = parts.filter((p) => p.functionCall).map((p, i) => ({ id: `gemini-${Date.now()}-${i}`, name: p.functionCall.name, args: p.functionCall.args || {} }));
      const content = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
      return { content, toolCalls, native: parts };
    },
  };
}

module.exports = { createGeminiProvider };
