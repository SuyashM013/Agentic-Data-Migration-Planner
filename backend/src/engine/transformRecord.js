const { applyTransformation, isSupported, TransformError } = require('./transformations');
const { validateTargetValue, isMissing } = require('./validators');
const { normalizeSchema, has } = require('./schemaUtils');

const TRANSFORM_STAGE_RULES = (rule) => rule.startsWith('TRANSFORM_') || rule === 'UNSUPPORTED_TRANSFORMATION' || rule === 'UNKNOWN_TARGET_FIELD';

/**
 * Deterministically maps one source record to a target record using ONLY the approved mappings.
 *   1. iterate over approved mappings   2. read source field   3. apply whitelisted transformation
 *   4. assign target field              5. validate result      6. return record or all errors
 * Returns { transformed, transformOk, errors } where errors = [{ field, message, rule }].
 * `transformed` is null if any error exists. Nothing here touches the database or the LLM.
 */
function transformRecord(sourceRecord, plan, targetSchema) {
  const target = normalizeSchema(targetSchema);
  const out = {};
  const errors = [];
  const failedFields = new Set();

  for (const mapping of plan.mappings || []) {
    const { sourceField, targetField, transformation } = mapping;
    if (!has(target, targetField)) {
      errors.push({ field: targetField, message: `Target field "${targetField}" does not exist in the target schema`, rule: 'UNKNOWN_TARGET_FIELD' });
      failedFields.add(targetField);
      continue;
    }
    if (!isSupported(transformation)) {
      errors.push({ field: targetField, message: `Unsupported transformation "${transformation}"`, rule: 'UNSUPPORTED_TRANSFORMATION' });
      failedFields.add(targetField);
      continue;
    }
    const raw = has(sourceRecord, sourceField) ? sourceRecord[sourceField] : undefined;
    if (isMissing(raw)) continue; // handled by the required-field check below

    try {
      out[targetField] = applyTransformation(transformation, raw);
    } catch (e) {
      if (!(e instanceof TransformError)) throw e;
      errors.push({ field: targetField, message: e.message, rule: e.rule });
      failedFields.add(targetField);
    }
  }

  for (const [field, spec] of Object.entries(target)) {
    if (failedFields.has(field)) continue;
    if (!has(out, field) || isMissing(out[field])) {
      delete out[field];
      if (spec.required) errors.push({ field, message: 'Missing required value', rule: 'MISSING_REQUIRED' });
      continue;
    }
    errors.push(...validateTargetValue(field, out[field], spec));
  }

  const transformOk = !errors.some((e) => TRANSFORM_STAGE_RULES(e.rule));
  return { transformed: errors.length ? null : out, transformOk, errors };
}

/**
 * Runs the whole bounded dataset through transformRecord and applies dataset-level checks (duplicate source ids).
 * Pure function: same input -> same output.
 */
function processRecords(records, plan, targetSchema) {
  const idMapping = (plan.mappings || []).find((m) => m.targetField === 'id');
  const accepted = [];
  const rejected = [];
  const seenIds = new Map(); // sourceRecordId -> first rowIndex
  let transformedCount = 0;

  records.forEach((sourceRecord, rowIndex) => {
    const rawId = idMapping && has(sourceRecord, idMapping.sourceField) ? sourceRecord[idMapping.sourceField] : undefined;
    const hasRealId = !isMissing(rawId);
    const sourceRecordId = hasRealId ? String(rawId) : `row-${rowIndex}`;

    const result = transformRecord(sourceRecord, plan, targetSchema);
    if (result.transformOk) transformedCount += 1;
    const errors = [...result.errors];

    if (hasRealId && seenIds.has(sourceRecordId)) {
      errors.push({
        field: idMapping.targetField,
        message: `Duplicate source record id "${sourceRecordId}" (first seen at record #${seenIds.get(sourceRecordId) + 1})`,
        rule: 'DUPLICATE_SOURCE_ID',
      });
    }

    if (errors.length === 0) {
      if (hasRealId) seenIds.set(sourceRecordId, rowIndex);
      accepted.push({ rowIndex, sourceRecordId, record: result.transformed });
    } else {
      // A rejected record never claims its id, so the first valid occurrence of an id always wins.
      rejected.push({ rowIndex, sourceRecordId, sourceRecord, fieldErrors: errors });
    }
  });

  return { sourceCount: records.length, transformedCount, accepted, rejected };
}

module.exports = { transformRecord, processRecords };
