const { TRANSFORMATION_NAMES } = require('../constants');

class TransformError extends Error {
  constructor(transformation, message) {
    super(message);
    this.rule = `TRANSFORM_${transformation.toUpperCase()}`;
  }
}

const NUMERIC_RE = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;

function requireString(name, v) {
  if (typeof v !== 'string') throw new TransformError(name, `${name} expects a string but received ${typeof v}.`);
  return v;
}

const pad = (n) => String(n).padStart(2, '0');

function buildIsoDate(name, y, m, d, original) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new TransformError(name, `"${original}" is not a valid calendar date.`);
  }
  return `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;
}

// All implementations are plain, side-effect free JavaScript. The LLM can only pick a name from this table.
const IMPLEMENTATIONS = {
  none: (v) => v,
  trim: (v) => requireString('trim', v).trim(),
  lowercase: (v) => requireString('lowercase', v).toLowerCase(),
  uppercase: (v) => requireString('uppercase', v).toUpperCase(),
  normalize_phone: (v) => {
    const digits = requireString('normalize_phone', v).replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) {
      throw new TransformError('normalize_phone', `"${v}" does not contain 7-15 digits after normalisation.`);
    }
    return digits;
  },
  string_to_number: (v) => {
    const s = requireString('string_to_number', v).trim();
    if (!NUMERIC_RE.test(s)) throw new TransformError('string_to_number', `"${v}" is not a numeric string.`);
    const n = Number(s);
    if (!Number.isFinite(n)) throw new TransformError('string_to_number', `"${v}" is out of numeric range.`);
    return n;
  },
  number_to_string: (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new TransformError('number_to_string', `number_to_string expects a finite number but received ${typeof v}.`);
    return String(v);
  },
  date_format: (v) => {
    const s = requireString('date_format', v).trim();
    let m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s))) return buildIsoDate('date_format', +m[1], +m[2], +m[3], s);
    if ((m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(s))) return buildIsoDate('date_format', +m[1], +m[2], +m[3], s);
    if ((m = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(s))) return buildIsoDate('date_format', +m[3], +m[2], +m[1], s); // DD/MM/YYYY
    throw new TransformError('date_format', `"${s}" is not in a supported date format (DD/MM/YYYY, DD-MM-YYYY, YYYY/MM/DD, YYYY-MM-DD).`);
  },
};

// Guard: every whitelisted name has an implementation and vice versa.
if (TRANSFORMATION_NAMES.some((n) => !IMPLEMENTATIONS[n]) || Object.keys(IMPLEMENTATIONS).some((n) => !TRANSFORMATION_NAMES.includes(n))) {
  throw new Error('Transformation whitelist and implementations are out of sync');
}

function isSupported(name) {
  return typeof name === 'string' && TRANSFORMATION_NAMES.includes(name);
}

function applyTransformation(name, value) {
  if (!isSupported(name)) throw new TransformError('unsupported', `Unsupported transformation "${name}".`);
  return IMPLEMENTATIONS[name](value);
}

// Type rules used by the plan validator: [required input type | null for any, output type | null for "same as input"]
const TYPE_RULES = {
  none: [null, null],
  trim: ['string', 'string'],
  lowercase: ['string', 'string'],
  uppercase: ['string', 'string'],
  normalize_phone: ['string', 'string'],
  string_to_number: ['string', 'number'],
  number_to_string: ['number', 'string'],
  date_format: ['string', 'date'],
};

module.exports = { applyTransformation, isSupported, TransformError, TYPE_RULES };
