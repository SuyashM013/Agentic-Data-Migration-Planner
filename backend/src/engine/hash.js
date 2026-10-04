const crypto = require('crypto');

function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Fingerprint of everything that determines migration output: records, target schema, approved mappings. */
function inputHash({ records, targetSchema, mappings }) {
  const cleanMappings = mappings.map((m) => ({ s: m.sourceField, t: m.targetField, x: m.transformation }));
  return crypto.createHash('sha256').update(stableStringify({ records, targetSchema, cleanMappings })).digest('hex');
}

module.exports = { inputHash, stableStringify };
