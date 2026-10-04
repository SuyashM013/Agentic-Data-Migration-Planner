import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { shortId } from '../lib/format.js';
import { Alert, Button, LoadingBlock, StatusBadge } from '../components/ui.jsx';
import Stepper from '../components/Stepper.jsx';
import PlanTab from '../components/PlanTab.jsx';
import DryRunTab from '../components/DryRunTab.jsx';
import ExecutionTab from '../components/ExecutionTab.jsx';
import ReconciliationTab from '../components/ReconciliationTab.jsx';
import QuarantineTab from '../components/QuarantineTab.jsx';
import HistoryTab from '../components/HistoryTab.jsx';

const TABS = [
  ['plan', 'AI plan'],
  ['dryrun', 'Dry run'],
  ['execution', 'Execution'],
  ['reconciliation', 'Reconciliation'],
  ['quarantine', 'Quarantine'],
  ['history', 'History'],
];

function defaultTab(status) {
  if (['APPROVED', 'DRY_RUN_COMPLETED'].includes(status)) return 'dryrun';
  if (['EXECUTING', 'COMPLETED', 'ROLLED_BACK'].includes(status)) return 'execution';
  return 'plan';
}

export default function MigrationDetail() {
  const { id } = useParams();
  const [m, setM] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState(null);
  const [viewVersion, setViewVersion] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get(id);
      setM(data);
      setLoadError(null);
      return data;
    } catch (e) {
      setLoadError(e.message);
      return null;
    }
  }, [id]);

  useEffect(() => { load().then((d) => d && setTab((t) => t || defaultTab(d.status))); api.config().then(setCfg).catch(() => {}); }, [load]);
  useEffect(() => {
    if (!m || !['ANALYZING', 'EXECUTING'].includes(m.status)) return undefined;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [m, load]);

  /** Runs an API action with a busy flag, success/failure notices, then refreshes the migration. */
  async function run(key, fn, { success, nextTab, failure }) {
    setBusy(key);
    setNotice(null);
    try {
      const res = await fn();
      setNotice({ tone: 'good', text: typeof success === 'function' ? success(res) : success });
      setViewVersion(null);
      await load();
      if (nextTab) setTab(nextTab);
      return res;
    } catch (e) {
      const detail = Array.isArray(e.details) && e.details.length ? ` ${e.details.slice(0, 5).join(' ')}` : '';
      setNotice({ tone: 'bad', text: `${failure ? failure + ' ' : ''}${e.message}${detail}` });
      await load();
      return null;
    } finally {
      setBusy(null);
    }
  }

  const actions = {
    analyze: () => run('analyze', () => api.analyze(id), { success: 'AI plan generated. Review it before approving.', nextTab: 'plan', failure: 'AI analysis failed. Please retry.' }),
    approve: (body) => run('approve', () => api.approve(id, body), { success: 'Migration plan approved successfully.', nextTab: 'dryrun' }),
    reject: async (reason) => {
      const ok = await run('reject', () => api.reject(id, { reason }), { success: 'Plan rejected. Regenerating…' });
      if (ok) await actions.analyze();
    },
    dryRun: () => run('dryrun', () => api.dryRun(id), { success: 'Dry run completed.', nextTab: 'dryrun' }),
    execute: () => run('execute', () => api.execute(id), {
      success: (r) => (r.isRetry ? `Retry finished: ${r.insertedCount} new records, ${r.duplicateCount} duplicates skipped.` : `Migration completed: ${r.insertedCount} records inserted, ${r.rejectedCount} quarantined.`),
      nextTab: 'execution',
    }),
    rollback: () => run('rollback', () => api.rollback(id), { success: (r) => `Rollback complete: ${r.removed} records removed. History and quarantine evidence are preserved.`, nextTab: 'execution' }),
  };

  if (loadError && !m) return <Alert tone="bad" title="Could not load this migration" action={<Button variant="secondary" onClick={load}>Retry</Button>}>{loadError} <Link className="text-accent underline" to="/">Back to dashboard</Link></Alert>;
  if (!m) return <LoadingBlock label="Loading migration…" />;

  const transformations = cfg ? cfg.supportedTransformations.map((t) => t.name) : [];
  const current = tab || defaultTab(m.status);

  return (
    <div className="space-y-5">
      <div>
        <Link to="/" className="text-sm text-muted hover:text-ink">Migrations</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{m.name}</h1>
          <StatusBadge status={m.status} />
        </div>
        <p className="mt-0.5 font-mono text-xs text-muted">{shortId(m._id)} · {m.sampleCount} source records</p>
      </div>

      <div className="rounded-lg border border-line bg-surface px-4 py-3"><Stepper migration={m} /></div>

      {notice && <Alert tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}
      {m.status === 'FAILED' && m.lastError && !notice && <Alert tone="bad" title="This migration is in a failed state">{m.lastError}</Alert>}
      {m.status === 'ANALYZING' && <Alert tone="info">Analyzing migration… this page refreshes automatically.</Alert>}

      <div role="tablist" aria-label="Migration sections" className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={current === key} onClick={() => setTab(key)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${current === key ? 'border-accent font-medium text-accent' : 'border-transparent text-muted hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {current === 'plan' && <PlanTab m={m} actions={actions} busy={busy} transformations={transformations} viewVersion={viewVersion} setViewVersion={setViewVersion} />}
        {current === 'dryrun' && <DryRunTab m={m} actions={actions} busy={busy} goTo={setTab} />}
        {current === 'execution' && <ExecutionTab m={m} actions={actions} busy={busy} goTo={setTab} />}
        {current === 'reconciliation' && <ReconciliationTab m={m} goTo={setTab} />}
        {current === 'quarantine' && <QuarantineTab m={m} goTo={setTab} />}
        {current === 'history' && <HistoryTab m={m} onViewPlan={(v) => { setViewVersion(v); setTab('plan'); }} />}
      </div>
    </div>
  );
}
