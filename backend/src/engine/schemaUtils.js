const { SCHEMA_TYPES } = require('../constants');

const FIELD_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const FORBIDDEN_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isValidFieldName = (n) => typeof n === 'string' && FIELD_NAME_RE.test(n) && !FORBIDDEN_NAMES.has(n);

/**
 * Accepts { field: "type" } or { field: { type, required } } and returns
 * a normalized map { field: { type, required } }. Throws nothing; use validateSchemaShape for errors.
 * Fields are required unless explicitly declared `required: false`.
 */
function normalizeSchema(schema) {
  const out = {};
  for (const [name, spec] of Object.entries(schema || {})) {
    if (typeof spec === 'string') out[name] = { type: spec, required: true };
    else out[name] = { type: spec.type, required: spec.required !== false };
  }
  return out;
}

function validateSchemaShape(schema, label) {
  const errors = [];
  if (!isPlainObject(schema)) return [`${label} must be a JSON object of { field: type }.`];
  const names = Object.keys(schema);
  if (names.length === 0) errors.push(`${label} must define at least one field.`);
  if (names.length > 100) errors.push(`${label} has too many fields (max 100).`);
  for (const name of names) {
    if (!isValidFieldName(name)) {
      errors.push(`${label}: invalid field name "${name}" (letters, digits, underscore; must not start with a digit).`);
      continue;
    }
    const spec = schema[name];
    if (typeof spec === 'string') {
      if (!SCHEMA_TYPES.includes(spec)) errors.push(`${label}.${name}: unsupported type "${spec}" (allowed: ${SCHEMA_TYPES.join(', ')}).`);
    } else if (isPlainObject(spec)) {
      if (!SCHEMA_TYPES.includes(spec.type)) errors.push(`${label}.${name}: unsupported type "${spec.type}" (allowed: ${SCHEMA_TYPES.join(', ')}).`);
      if (spec.required !== undefined && typeof spec.required !== 'boolean') errors.push(`${label}.${name}: "required" must be true or false.`);
    } else {
      errors.push(`${label}.${name}: must be a type string or { "type", "required" }.`);
    }
  }
  return errors;
}

module.exports = { normalizeSchema, validateSchemaShape, isPlainObject, has, isValidFieldName };
