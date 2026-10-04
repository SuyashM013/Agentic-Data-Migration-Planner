import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Alert, Badge, Button, Card } from '../components/ui.jsx';

const pretty = (v) => JSON.stringify(v, null, 2);

function parseJson(text, label) {
  if (!text.trim()) return { error: `${label} is required.` };
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: `Please provide a valid JSON ${label.toLowerCase()}.` };
  }
}

function JsonField({ id, label, hint, value, onChange, error, rows = 9, extra }) {
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        {extra}
      </div>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        spellCheck={false}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-help`}
        className={`w-full rounded-md border bg-surface px-3 py-2 font-mono text-xs leading-relaxed ${error ? 'border-bad' : 'border-line'}`}
      />
      <p id={`${id}-help`} className={`mt-1 text-xs ${error ? 'text-bad' : 'text-muted'}`}>{error || hint}</p>
    </div>
  );
}

export default function CreateMigration() {
  const navigate = useNavigate();
  const [cfg, setCfg] = useState(null);
  const [demo, setDemo] = useState(null);
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [records, setRecords] = useState('');
  const [errors, setErrors] = useState({});
  const [phase, setPhase] = useState('idle'); // idle | creating | analyzing
  const [failure, setFailure] = useState(null);
  const [createdId, setCreatedId] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    api.config().then(setCfg).catch(() => {});
    api.demoData().then(setDemo).catch(() => {});
  }, []);

  const loadDemo = (key) => {
    const d = demo[key];
    setName(d.name);
    setSource(pretty(d.sourceSchema));
    setTarget(pretty(d.targetSchema));
    setRecords(pretty(d.sampleRecords));
    setErrors({});
    setFailure(null);
    setCreatedId(null);
  };

  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > 900_000) {
      setErrors((x) => ({ ...x, records: 'File is too large for this bounded MVP (max ~900 KB).' }));
      return;
    }
    setRecords(await f.text());
    setErrors((x) => ({ ...x, records: undefined }));
    e.target.value = '';
  };

  const max = cfg ? cfg.maxSampleRecords : 100;
  let count = null;
  try { const p = JSON.parse(records); if (Array.isArray(p)) count = p.length; } catch { /* ignore */ }

  function validate() {
    const e = {};
    if (!name.trim()) e.name = 'Migration name is required.';
    const s = parseJson(source, 'Source schema');
    const t = parseJson(target, 'Target schema');
    const r = parseJson(records, 'Sample records');
    if (s.error) e.source = s.error;
    else if (typeof s.value !== 'object' || Array.isArray(s.value) || s.value === null) e.source = 'Source schema must be a JSON object of { field: type }.';
    if (t.error) e.target = t.error;
    else if (typeof t.value !== 'object' || Array.isArray(t.value) || t.value === null) e.target = 'Target schema must be a JSON object of { field: type }.';
    if (r.error) e.records = r.error;
    else if (!Array.isArray(r.value) || r.value.length === 0) e.records = 'Sample records must be a non-empty JSON array.';
    else if (r.value.length > max) e.records = `This MVP supports at most ${max} sample records (you provided ${r.value.length}).`;
    setErrors(e);
    return Object.keys(e).length ? null : { name: name.trim(), sourceSchema: s.value, targetSchema: t.value, sampleRecords: r.value };
  }

  async function submit(ev) {
    ev.preventDefault();
    setFailure(null);
    let id = createdId;
    if (!id) {
      const payload = validate();
      if (!payload) return;
      setPhase('creating');
      try {
        id = (await api.create(payload))._id;
        setCreatedId(id);
      } catch (err) {
        setPhase('idle');
        if (err.details && Array.isArray(err.details)) setFailure(err.details.join(' '));
        else setFailure(err.message);
        return;
      }
    }
    setPhase('analyzing');
    try {
      await api.analyze(id);
      navigate(`/migrations/${id}`);
    } catch (err) {
      setPhase('idle');
      setFailure(`AI analysis failed. Please retry. (${err.message})`);
    }
  }

  const busy = phase !== 'idle';
  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">New migration</h1>
          <p className="text-sm text-muted">One source, one target, one bounded dataset (max {max} records).</p>
        </div>
        {demo && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => loadDemo('full')} disabled={busy || Boolean(createdId)}>Load demo: 100 records</Button>
            <Button variant="secondary" onClick={() => loadDemo('mini')} disabled={busy || Boolean(createdId)}>Load demo: brief example</Button>
          </div>
        )}
      </div>

      {failure && (
        <Alert tone="bad" title={createdId ? 'Migration saved, analysis did not finish' : 'Could not create the migration'}
          action={createdId ? <Link className="text-sm font-medium text-accent hover:underline" to={`/migrations/${createdId}`}>Open the saved migration</Link> : null}>
          {failure}
        </Alert>
      )}

      <Card>
        <label htmlFor="name" className="mb-1 block text-sm font-medium">Migration name</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} disabled={Boolean(createdId)} maxLength={120} aria-invalid={Boolean(errors.name)}
          className={`w-full rounded-md border bg-surface px-3 py-2 text-sm ${errors.name ? 'border-bad' : 'border-line'}`} placeholder="e.g. Customer migration" />
        {errors.name && <p className="mt-1 text-xs text-bad">{errors.name}</p>}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <JsonField id="source" label="Source schema" value={source} onChange={setSource} error={errors.source}
          hint={'JSON object, e.g. { "customer_id": "number" }. Fields are required unless set as { "type": "string", "required": false }.'} />
        <JsonField id="target" label="Target schema" value={target} onChange={setTarget} error={errors.target}
          hint={`Allowed types: ${cfg ? cfg.schemaTypes.join(', ') : 'string, number, boolean, date'}.`} />
      </div>

      <JsonField id="records" label="Sample source records" rows={12} value={records} onChange={setRecords} error={errors.records}
        hint="JSON array of objects. Upload a .json file or paste directly."
        extra={
          <div className="flex items-center gap-2">
            {count !== null && <Badge tone={count > max ? 'bad' : 'neutral'}>{count} / {max} records</Badge>}
            <input ref={fileRef} type="file" accept="application/json,.json" onChange={onFile} className="sr-only" id="records-file" />
            <Button variant="secondary" className="!py-1 text-xs" onClick={() => fileRef.current && fileRef.current.click()}>Upload JSON file</Button>
          </div>
        } />

      <Card title="Supported transformations" subtitle="The AI can only choose from this fixed list. The backend implements each one deterministically.">
        <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {(cfg ? cfg.supportedTransformations : []).map((t) => (
            <li key={t.name} className="text-sm"><code className="rounded bg-paper px-1.5 py-0.5 font-mono text-xs">{t.name}</code> <span className="text-muted">{t.description}</span></li>
          ))}
        </ul>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {phase === 'creating' && <span className="text-sm text-muted" role="status">Saving migration…</span>}
        {phase === 'analyzing' && <span className="text-sm text-muted" role="status">Analyzing migration… the agent is inspecting schemas and sample records.</span>}
        <Button type="submit" loading={busy}>{createdId ? 'Retry analysis' : 'Analyze with AI'}</Button>
      </div>
    </form>
  );
}
