/**
 * OFFLINE DEMO PLANNER - this is NOT an LLM.
 * It implements the same provider interface so the whole agent loop (tool calls -> validation -> plan) runs without an API key.
 * It calls the same read-only tools and then applies simple name-similarity heuristics. Label: "mock:heuristic".
 */
const SYNONYMS = [
  ['id', 'customer_id', 'cust_id', 'customerid', 'user_id', 'uid'],
  ['name', 'full_name', 'fullname', 'customer_name'],
  ['email', 'email_address', 'mail', 'e_mail'],
  ['phone', 'contact_number', 'mobile', 'telephone', 'contact', 'phone_number', 'mobile_number'],
  ['city', 'location', 'town', 'address'],
  ['signup_date', 'created_at', 'created', 'joined_at', 'registered_at', 'registration_date'],
];
const groupOf = (n) => SYNONYMS.findIndex((g) => g.includes(n.toLowerCase()));
const tokens = (n) => new Set(n.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));

function similarity(a, b) {
  if (a.toLowerCase() === b.toLowerCase()) return { score: 1, kind: 'exact' };
  const ga = groupOf(a);
  if (ga !== -1 && ga === groupOf(b)) return { score: 0.9, kind: 'synonym' };
  const ta = tokens(a);
  const tb = tokens(b);
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return { score: union ? inter / union : 0, kind: 'tokens' };
}

function pickTransformation(src, tgt, tgtName, srcName) {
  if (src.type === 'string' && tgt.type === 'number') return 'string_to_number';
  if (src.type === 'number' && tgt.type === 'string') return 'number_to_string';
  if (src.type === 'string' && tgt.type === 'date') return 'date_format';
  if (src.type === 'string' && tgt.type === 'string') {
    if (/email/i.test(tgtName)) return 'lowercase';
    if (/(phone|contact|mobile)/i.test(tgtName) || /(phone|mobile)/i.test(srcName)) return 'normalize_phone';
    return 'trim';
  }
  if (src.type === tgt.type) return 'none';
  return null; // incompatible - cannot be bridged with the whitelist
}

function plan(sourceFields, targetFields) {
  const mappings = [];
  const risks = [];
  const questions = [];
  const usedTargets = new Set();
  const scored = [];
  for (const s of sourceFields) for (const t of targetFields) scored.push({ s, t, ...similarity(s.name, t.name) });
  scored.sort((x, y) => y.score - x.score);
  const usedSources = new Set();
  for (const c of scored) {
    if (c.score < 0.5 || usedSources.has(c.s.name) || usedTargets.has(c.t.name)) continue;
    const transformation = pickTransformation(c.s, c.t, c.t.name, c.s.name);
    if (!transformation) {
      risks.push({ severity: 'high', message: `${c.s.name} (${c.s.type}) looks like ${c.t.name} (${c.t.type}) but no supported transformation can convert between these types.` });
      continue;
    }
    usedSources.add(c.s.name);
    usedTargets.add(c.t.name);
    const confidence = c.kind === 'exact' ? 'high' : c.kind === 'synonym' ? 'high' : 'medium';
    const how = transformation === 'none' ? 'copied unchanged' : `converted with ${transformation}`;
    mappings.push({
      sourceField: c.s.name,
      targetField: c.t.name,
      transformation,
      confidence,
      reason: `Field names ${c.kind === 'exact' ? 'match exactly' : c.kind === 'synonym' ? 'are common synonyms' : 'share name tokens'}; ${c.s.type} → ${c.t.type}, ${how}.`,
    });
  }
  const order = (n) => sourceFields.findIndex((f) => f.name === n);
  mappings.sort((a, b) => order(a.sourceField) - order(b.sourceField));
  const unmappedSourceFields = sourceFields.filter((f) => !usedSources.has(f.name)).map((f) => f.name);
  const unmappedTargetFields = targetFields.filter((f) => !usedTargets.has(f.name)).map((f) => f.name);
  for (const f of unmappedSourceFields) questions.push(`Source field "${f}" has no obvious target. Should it be dropped or mapped somewhere?`);
  for (const f of unmappedTargetFields) {
    const t = targetFields.find((x) => x.name === f);
    questions.push(`Target field "${f}" has no source field. ${t.required ? 'It is required, so who supplies its value?' : 'It is optional; confirm it can stay empty.'}`);
  }
  return { mappings, unmappedSourceFields, unmappedTargetFields, risks, clarificationQuestions: questions };
}

function createMockProvider() {
  return {
    label: 'mock:heuristic',
    async chat({ messages }) {
      const results = {};
      for (const m of messages) if (m.role === 'tool') { try { results[m.name] = JSON.parse(m.content); } catch { /* ignore */ } }
      if (!results.inspectSourceSchema) {
        return {
          content: '',
          toolCalls: ['inspectSourceSchema', 'inspectTargetSchema', 'inspectSampleRecords', 'getSupportedTransformations'].map((name, i) => ({ id: `mock-${i}`, name, args: {} })),
        };
      }
      const proposal = plan(results.inspectSourceSchema.fields, results.inspectTargetSchema.fields);
      if (!results.validateMapping) {
        return { content: '', toolCalls: [{ id: 'mock-v', name: 'validateMapping', args: { mappings: proposal.mappings } }] };
      }
      const profile = (results.inspectSampleRecords && results.inspectSampleRecords.fieldProfile) || [];
      for (const p of profile) {
        if (p.missing > 0) proposal.risks.push({ severity: 'medium', message: `Field "${p.field}" is missing in ${p.missing} sample record(s).` });
      }
      return { content: JSON.stringify(proposal), toolCalls: [] };
    },
  };
}

module.exports = { createMockProvider };
