const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const isEmailField = (name) => /(^|_)email$/i.test(name);

function isValidIsoDate(s) {
  const m = ISO_DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const isMissing = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Validates one transformed value against the target field spec. Returns an array of { field, message, rule }. */
function validateTargetValue(field, value, spec) {
  const errors = [];
  const typeOk = {
    string: typeof value === 'string',
    number: typeof value === 'number' && Number.isFinite(value),
    boolean: typeof value === 'boolean',
    date: typeof value === 'string' && isValidIsoDate(value),
  }[spec.type];

  if (!typeOk) {
    errors.push({ field, message: `Expected ${spec.type} but received ${typeof value === 'string' ? `"${value}"` : typeof value}`, rule: 'TYPE_MISMATCH' });
    return errors;
  }
  if (spec.type === 'string' && isEmailField(field) && (value.length > 254 || !EMAIL_RE.test(value))) {
    errors.push({ field, message: 'Invalid email format', rule: 'EMAIL_FORMAT' });
  }
  return errors;
}

module.exports = { validateTargetValue, isMissing, isEmailField, isValidIsoDate };
