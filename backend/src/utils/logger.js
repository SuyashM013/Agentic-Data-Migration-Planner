// Structured JSON logger with secret redaction.
const SENSITIVE = /(api[-_]?key|secret|token|password|authorization|credential)/i;

function redact(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return value.slice(0, 500) + '…[truncated]';
  return value;
}

function log(event, data = {}, level = 'info') {
  if (process.env.NODE_ENV === 'test') return;
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, event, ...redact(data) }) + '\n');
}

module.exports = {
  info: (event, data) => log(event, data, 'info'),
  warn: (event, data) => log(event, data, 'warn'),
  error: (event, data) => log(event, data, 'error'),
  redact,
};
