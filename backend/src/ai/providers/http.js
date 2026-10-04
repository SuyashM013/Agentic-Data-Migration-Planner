const { AppError } = require('../../utils/errors');

/** POST JSON with a timeout. Error messages never include the request URL, headers or API key. */
async function postJson(url, headers, body, { timeoutMs, secrets = [], provider }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
  } catch (e) {
    throw new AppError(502, 'AI_PROVIDER_ERROR', e.name === 'AbortError' ? `${provider} request timed out after ${timeoutMs} ms.` : `Could not reach ${provider}.`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = JSON.parse(text).error.message || text; } catch { /* keep raw text */ }
    for (const s of secrets.filter(Boolean)) msg = msg.split(s).join('[REDACTED]');
    throw new AppError(502, 'AI_PROVIDER_ERROR', `${provider} returned HTTP ${res.status}: ${String(msg).slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(502, 'AI_PROVIDER_ERROR', `${provider} returned a non-JSON response.`);
  }
}

module.exports = { postJson };
