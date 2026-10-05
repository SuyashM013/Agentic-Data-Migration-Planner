const BASE = (import.meta.env.API_URL || 'http://localhost:5000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(`Cannot reach the API at ${BASE}. Is the backend running?`, { code: 'NETWORK' });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data && data.error) || {};
    throw new ApiError(err.message || `Request failed (${res.status})`, { status: res.status, code: err.code, details: err.details });
  }
  return data;
}

export const api = {
  config: () => request('GET', '/config'),
  demoData: () => request('GET', '/demo-data'),
  list: () => request('GET', '/migrations'),
  get: (id) => request('GET', `/migrations/${id}`),
  create: (payload) => request('POST', '/migrations', payload),
  analyze: (id) => request('POST', `/migrations/${id}/analyze`),
  approve: (id, body) => request('POST', `/migrations/${id}/approve`, body || {}),
  reject: (id, body) => request('POST', `/migrations/${id}/reject`, body || {}),
  dryRun: (id) => request('POST', `/migrations/${id}/dry-run`),
  execute: (id) => request('POST', `/migrations/${id}/execute`),
  rollback: (id) => request('POST', `/migrations/${id}/rollback`),
  quarantine: (id) => request('GET', `/migrations/${id}/quarantine`),
  targetRecords: (id) => request('GET', `/migrations/${id}/target-records`),
  history: (id) => request('GET', `/migrations/${id}/history`),
};
