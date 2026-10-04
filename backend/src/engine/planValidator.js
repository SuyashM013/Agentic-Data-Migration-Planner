const { CONFIDENCE, TRANSFORMATION_NAMES } = require('../constants');
const { normalizeSchema, isPlainObject, has } = require('./schemaUtils');
const { TYPE_RULES } = require('./transformations');

const SEVERITIES = ['low', 'medium', 'high'];
const MAX_MAPPINGS = 100;

function outputType(transformation, sourceType) {
  const [, out] = TYPE_RULES[transformation];
  return out === null ? sourceType : out;
}

/**
 * Validates a (possibly LLM-produced) plan against the real schemas and the transformation whitelist.
 * Nothing the model says is stored unless it passes here. Returns:
 *   { valid, problems[], warnings[], plan }  where `plan` is a clean, normalized copy (only known keys).
 * Unmapped field lists are always recomputed here, never trusted from the model.
 */
function validatePlan(raw, sourceSchema, targetSchema) {
  const problems = [];
  const warnings = [];
  const source = normalizeSchema(sourceSchema);
  const target = normalizeSchema(targetSchema);

  if (!isPlainObject(raw)) {
    return { valid: false, problems: ['Plan must be a JSON object.'], warnings, plan: null };
  }
  if (!Array.isArray(raw.mappings)) problems.push('Plan must contain a "mappings" array.');

  const mappings = [];
  const seenTargets = new Map();

  (Array.isArray(raw.mappings) ? raw.mappings : []).slice(0, MAX_MAPPINGS).forEach((m, i) => {
    const label = `Mapping #${i + 1}`;
    if (!isPlainObject(m)) {
      problems.push(`${label} must be an object.`);
      return;
    }
    const { sourceField, targetField } = m;
    const transformation = m.transformation === undefined ? 'none' : m.transformation;
    let ok = true;

    if (typeof sourceField !== 'string' || !has(source, sourceField)) {
      problems.push(`${label}: source field "${sourceField}" does not exist in the source schema (fields must not be invented).`);
      ok = false;
    }
    if (typeof targetField !== 'string' || !has(target, targetField)) {
      problems.push(`${label}: target field "${targetField}" does not exist in the target schema (fields must not be invented).`);
      ok = false;
    }
    if (typeof transformation !== 'string' || !TRANSFORMATION_NAMES.includes(transformation)) {
      problems.push(`${label}: transformation "${transformation}" is not supported. Allowed: ${TRANSFORMATION_NAMES.join(', ')}.`);
      ok = false;
    }
    const reason = typeof m.reason === 'string' ? m.reason.trim().slice(0, 500) : '';
    if (!reason) {
      problems.push(`${label}: every mapping needs a non-empty "reason".`);
      ok = false;
    }
    let confidence = typeof m.confidence === 'string' ? m.confidence.toLowerCase() : '';
    if (!CONFIDENCE.includes(confidence)) {
      warnings.push(`${label}: confidence "${m.confidence}" is invalid; treated as "low".`);
      confidence = 'low';
    }

    if (ok) {
      const [needsInput] = TYPE_RULES[transformation];
      const srcType = source[sourceField].type;
      const tgtType = target[targetField].type;
      if (needsInput && needsInput !== srcType) {
        problems.push(`${label}: "${transformation}" requires a ${needsInput} source but "${sourceField}" is ${srcType}.`);
        ok = false;
      } else if (outputType(transformation, srcType) !== tgtType) {
        problems.push(
          `${label}: incompatible types - "${sourceField}" (${srcType}) with "${transformation}" yields ${outputType(transformation, srcType)}, but "${targetField}" is ${tgtType}.`
        );
        ok = false;
      }
    }
    if (ok && seenTargets.has(targetField)) {
      problems.push(`${label}: target field "${targetField}" is already mapped by mapping #${seenTargets.get(targetField)}.`);
      ok = false;
    }
    if (ok) {
      seenTargets.set(targetField, i + 1);
      mappings.push({ sourceField, targetField, transformation, confidence, reason });
    }
  });

  if (Array.isArray(raw.mappings) && raw.mappings.length > MAX_MAPPINGS) warnings.push(`Only the first ${MAX_MAPPINGS} mappings were considered.`);
  if (Array.isArray(raw.mappings) && raw.mappings.length === 0) problems.push('Plan contains no mappings.');

  const mappedSources = new Set(mappings.map((m) => m.sourceField));
  const mappedTargets = new Set(mappings.map((m) => m.targetField));
  const unmappedSourceFields = Object.keys(source).filter((f) => !mappedSources.has(f));
  const unmappedTargetFields = Object.keys(target).filter((f) => !mappedTargets.has(f));

  const risks = [];
  (Array.isArray(raw.risks) ? raw.risks : []).slice(0, 20).forEach((r) => {
    const message = typeof r === 'string' ? r : isPlainObject(r) && typeof r.message === 'string' ? r.message : null;
    if (!message || !message.trim()) return;
    const sev = isPlainObject(r) && typeof r.severity === 'string' ? r.severity.toLowerCase() : 'medium';
    risks.push({ severity: SEVERITIES.includes(sev) ? sev : 'medium', message: message.trim().slice(0, 500), source: 'ai' });
  });
  const clarificationQuestions = (Array.isArray(raw.clarificationQuestions) ? raw.clarificationQuestions : [])
    .filter((q) => typeof q === 'string' && q.trim())
    .slice(0, 10)
    .map((q) => q.trim().slice(0, 500));

  // Deterministic, backend-authored risks (always present regardless of what the model said).
  for (const f of unmappedTargetFields) {
    if (target[f].required) {
      risks.push({ severity: 'high', message: `Required target field "${f}" has no mapping - every record will be rejected with MISSING_REQUIRED until it is mapped.`, source: 'backend' });
    }
  }
  for (const f of unmappedSourceFields) {
    risks.push({ severity: 'low', message: `Source field "${f}" is not migrated (data in this field will not reach the target).`, source: 'backend' });
  }
  for (const m of mappings) {
    if (m.confidence === 'low') risks.push({ severity: 'medium', message: `Mapping ${m.sourceField} → ${m.targetField} has low confidence; review before approving.`, source: 'backend' });
    if (['string_to_number', 'date_format', 'normalize_phone'].includes(m.transformation)) {
      risks.push({ severity: 'medium', message: `"${m.transformation}" on ${m.sourceField} can fail for malformed values; failing records will be quarantined, not inserted.`, source: 'backend' });
    }
  }

  return {
    valid: problems.length === 0,
    problems,
    warnings,
    plan: { mappings, unmappedSourceFields, unmappedTargetFields, risks, clarificationQuestions },
  };
}

module.exports = { validatePlan };
