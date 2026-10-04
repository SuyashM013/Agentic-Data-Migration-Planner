const { runMigrationAgent } = require('../src/services/agentService');
const { createToolbox } = require('../src/tools');
const { createOpenAIProvider } = require('../src/ai/providers/openai');
const { createGeminiProvider } = require('../src/ai/providers/gemini');
const { getProvider } = require('../src/ai');
const { extractJson } = require('../src/ai/extractJson');
const logger = require('../src/utils/logger');
const { buildDemoDatasets } = require('../src/seed/demoData');

process.env.NODE_ENV = 'test';
const mini = buildDemoDatasets().mini;
const migration = { _id: 'm1', name: 'Test', sourceSchema: mini.sourceSchema, targetSchema: mini.targetSchema, sampleRecords: mini.sampleRecords };

const goodMapping = (over = {}) => ({ sourceField: 'customer_id', targetField: 'id', transformation: 'none', confidence: 'high', reason: 'ids', ...over });
const fullGood = () => ({
  mappings: [
    goodMapping(),
    goodMapping({ sourceField: 'full_name', targetField: 'name', transformation: 'trim' }),
    goodMapping({ sourceField: 'email', targetField: 'email', transformation: 'lowercase' }),
    goodMapping({ sourceField: 'phone', targetField: 'contact_number', transformation: 'normalize_phone' }),
    goodMapping({ sourceField: 'city', targetField: 'location', transformation: 'trim' }),
  ],
  risks: ['one record has a malformed email'],
  clarificationQuestions: [],
});

/** A scripted stand-in for an LLM: returns each reply in order. */
const scripted = (replies) => {
  let i = 0;
  const seen = [];
  return { label: 'scripted', seen, chat: async (req) => { seen.push({ ...req, messages: [...req.messages] }); return replies[Math.min(i++, replies.length - 1)]; } };
};
const final = (obj) => ({ content: typeof obj === 'string' ? obj : JSON.stringify(obj), toolCalls: [] });

describe('agent loop: AI output is never trusted', () => {
  test('accepts a valid plan wrapped in markdown fences', async () => {
    const p = scripted([final('```json\n' + JSON.stringify(fullGood()) + '\n```')]);
    const r = await runMigrationAgent({ migration, provider: p });
    expect(r.plan.mappings).toHaveLength(5);
    expect(r.plan.risks[0]).toMatchObject({ source: 'ai' });
  });

  test('AI mistake: unsupported transformation + invented field -> backend rejects, agent repairs once', async () => {
    const bad = fullGood();
    bad.mappings[3].transformation = 'normalize_phone_with_regex("..")';
    bad.mappings.push(goodMapping({ sourceField: 'loyalty_tier', targetField: 'tier' }));
    const p = scripted([final(bad), final(fullGood())]);
    const r = await runMigrationAgent({ migration, provider: p });
    expect(r.plan.mappings).toHaveLength(5);
    const repairPrompt = p.seen[1].messages[p.seen[1].messages.length - 1].content;
    expect(repairPrompt).toMatch(/not supported/);
    expect(repairPrompt).toMatch(/loyalty_tier/);
    expect(r.activity.some((a) => a.status === 'error' && /rejected/.test(a.step))).toBe(true);
  });

  test('AI keeps producing invalid output -> discarded with AI_PLAN_INVALID', async () => {
    const bad = { mappings: [goodMapping({ sourceField: 'ghost' })] };
    const p = scripted([final(bad), final(bad)]);
    await expect(runMigrationAgent({ migration, provider: p })).rejects.toMatchObject({ status: 422, code: 'AI_PLAN_INVALID' });
  });

  test('non-JSON reply is handled', async () => {
    const p = scripted([final('Sure! Here is my plan in prose.'), final('still prose')]);
    await expect(runMigrationAgent({ migration, provider: p })).rejects.toMatchObject({ code: 'AI_PLAN_INVALID' });
  });

  test('unknown tools are refused, not executed', async () => {
    const p = scripted([
      { content: '', toolCalls: [{ id: '1', name: 'runSql', args: { sql: 'DROP TABLE x' } }, { id: '2', name: 'constructor', args: {} }] },
      final(fullGood()),
    ]);
    const r = await runMigrationAgent({ migration, provider: p });
    const refused = r.activity.filter((a) => /Refused/.test(a.step));
    expect(refused.map((a) => a.tool)).toEqual(['runSql', 'constructor']);
    const toolMsgs = p.seen[1].messages.filter((m) => m.role === 'tool');
    expect(toolMsgs[0].content).toMatch(/Unknown tool/);
  });

  test('runaway tool use is stopped', async () => {
    const loop = { content: '', toolCalls: [{ id: 'x', name: 'inspectSourceSchema', args: {} }] };
    await expect(runMigrationAgent({ migration, provider: scripted([loop]) })).rejects.toMatchObject({ code: 'AI_AGENT_ERROR' });
  });

  test('the model never receives write-capable tools', () => {
    const names = createToolbox(migration).definitions.map((t) => t.name).sort();
    expect(names).toEqual(['getSupportedTransformations', 'inspectSampleRecords', 'inspectSourceSchema', 'inspectTargetSchema', 'validateMapping']);
  });
});

describe('tools', () => {
  const tb = createToolbox(migration);
  test('inspectSampleRecords caps the limit and profiles fields', () => {
    const big = createToolbox({ ...migration, sampleRecords: Array.from({ length: 50 }, (_, i) => ({ customer_id: i, email: i % 2 ? '' : 'a@b.co' })) });
    const out = big.execute('inspectSampleRecords', { limit: 999 }).result;
    expect(out.records).toHaveLength(10);
    expect(out.totalRecords).toBe(50);
    expect(out.fieldProfile.find((f) => f.field === 'email').missing).toBe(25);
  });
  test('validateMapping reports problems without storing anything', () => {
    const out = tb.execute('validateMapping', { mappings: [goodMapping({ transformation: 'drop_table' })] }).result;
    expect(out.valid).toBe(false);
    expect(out.problems[0]).toMatch(/not supported/);
  });
});

describe('provider adapters', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  const cfg = { openaiKey: 'sk-test-secret', openaiModel: 'gpt-x', geminiKey: 'g-test-secret', geminiModel: 'gem-x', timeoutMs: 2000 };

  test('missing keys give a clear configuration error', () => {
    expect(() => getProvider({ provider: 'openai', openaiKey: '' })).toThrow(/OPENAI_API_KEY/);
    expect(() => getProvider({ provider: 'gemini', geminiKey: '' })).toThrow(/GEMINI_API_KEY/);
    expect(() => getProvider({ provider: 'nope' })).toThrow(/Unknown AI_PROVIDER/);
  });

  test('OpenAI: sends tools + bearer key, parses tool calls', async () => {
    let captured;
    global.fetch = jest.fn(async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) };
      return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'inspectSourceSchema', arguments: '{}' } }] } }] }) };
    });
    const p = createOpenAIProvider(cfg);
    const out = await p.chat({ messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], tools: createToolbox(migration).definitions });
    expect(captured.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(captured.init.headers.authorization).toBe('Bearer sk-test-secret');
    expect(captured.body.tools).toHaveLength(5);
    expect(captured.body.model).toBe('gpt-x');
    expect(out.toolCalls).toEqual([{ id: 'c1', name: 'inspectSourceSchema', args: {} }]);
  });

  test('Gemini: key goes in a header (not the URL); function calls and responses round-trip', async () => {
    let captured;
    global.fetch = jest.fn(async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) };
      return { ok: true, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: 'inspectTargetSchema', args: {} }, thoughtSignature: 'sig' }] } }] }) };
    });
    const p = createGeminiProvider(cfg);
    const out = await p.chat({
      messages: [
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'inspectSourceSchema', args: {} }] },
        { role: 'tool', toolCallId: 'a', name: 'inspectSourceSchema', content: '{"fields":[]}' },
      ],
      tools: createToolbox(migration).definitions,
    });
    expect(captured.url).not.toMatch(/g-test-secret/);
    expect(captured.init.headers['x-goog-api-key']).toBe('g-test-secret');
    expect(captured.body.systemInstruction.parts[0].text).toBe('s');
    expect(captured.body.contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(captured.body.contents[2].parts[0].functionResponse.name).toBe('inspectSourceSchema');
    expect(out.toolCalls[0].name).toBe('inspectTargetSchema');
    expect(out.native[0].thoughtSignature).toBe('sig'); // replayed verbatim on the next turn
  });

  test('provider errors never leak the API key', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'Bad key sk-test-secret provided' } }) }));
    const p = createOpenAIProvider(cfg);
    const err = await p.chat({ messages: [{ role: 'user', content: 'u' }], tools: [] }).catch((e) => e);
    expect(err.status).toBe(502);
    expect(err.message).not.toMatch(/sk-test-secret/);
    expect(err.message).toMatch(/REDACTED/);
  });

  test('network failure becomes a clean 502', async () => {
    global.fetch = jest.fn(async () => { throw new Error('ECONNRESET sk-test-secret'); });
    const err = await createOpenAIProvider(cfg).chat({ messages: [], tools: [] }).catch((e) => e);
    expect(err).toMatchObject({ status: 502, code: 'AI_PROVIDER_ERROR' });
    expect(err.message).not.toMatch(/sk-test-secret/);
  });
});

describe('utilities', () => {
  test('extractJson tolerates fences and prose', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":2} thanks')).toEqual({ a: 2 });
    expect(extractJson('nope')).toBeUndefined();
  });
  test('logger redacts secrets', () => {
    expect(logger.redact({ OPENAI_API_KEY: 'x', nested: { authorization: 'Bearer y', ok: 1 }, password: 'p' })).toEqual({ OPENAI_API_KEY: '[REDACTED]', nested: { authorization: '[REDACTED]', ok: 1 }, password: '[REDACTED]' });
  });
});
