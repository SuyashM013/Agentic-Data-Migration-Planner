import { Alert, Button, Card, EmptyState } from './ui.jsx';

function Term({ label, value, tone = 'text-ink' }) {
  return (
    <div className="min-w-[6.5rem] px-3 py-2 text-center">
      <div className={`tnum text-3xl font-semibold ${tone}`}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
const Op = ({ children }) => <div className="self-start pt-3 text-xl text-muted" aria-hidden="true">{children}</div>;

export default function ReconciliationTab({ m, goTo }) {
  const r = m.reconciliation;
  if (!r || r.state === 'NOT_EXECUTED') {
    return <EmptyState title="Nothing to reconcile yet" action={<Button variant="secondary" onClick={() => goTo('dryrun')}>Go to dry run</Button>}>Reconciliation compares the accepted count with what is actually in the target store, once the migration has been executed.</EmptyState>;
  }
  const ok = r.passed;
  return (
    <div className="space-y-5">
      {ok ? (
        <Alert tone="good" title={r.state === 'ROLLED_BACK' ? '✓ Rolled back cleanly' : '✓ Reconciliation Passed'}>
          {r.state === 'ROLLED_BACK' ? 'The target store holds no records from this migration.' : 'The target store matches what the approved plan accepted.'}
        </Alert>
      ) : (
        <Alert tone="bad" title="✕ Reconciliation Failed">The target store does not match the expected count. Review the checks below.</Alert>
      )}

      <Card title="Expected vs inserted">
        <div className="flex flex-wrap items-start justify-center gap-x-1 gap-y-2 py-2">
          <Term label="Source records" value={r.sourceCount} />
          <Op>=</Op>
          <Term label="Accepted" value={r.acceptedCount} tone="text-good" />
          <Op>+</Op>
          <Term label="Rejected (quarantined)" value={r.rejectedCount} tone="text-bad" />
        </div>
        <div className="mx-auto my-3 h-px max-w-xl bg-line" />
        <div className="flex flex-wrap items-start justify-center gap-x-1 gap-y-2 py-2">
          <Term label={r.state === 'ROLLED_BACK' ? 'Expected after rollback' : 'Expected (accepted)'} value={r.expected} />
          <Op>−</Op>
          <Term label="Inserted in target" value={r.inserted} />
          <Op>=</Op>
          <Term label="Difference" value={r.difference} tone={r.difference === 0 ? 'text-good' : 'text-bad'} />
        </div>
        {r.duplicatesSkipped > 0 && <p className="mt-2 text-center text-xs text-muted">{r.duplicatesSkipped} duplicate insertions were prevented by retries.</p>}
      </Card>

      <Card title="Checks">
        <ul className="space-y-2 text-sm">
          {r.checks.map((c) => (
            <li key={c.name} className="flex items-start gap-2">
              <span className={c.passed ? 'text-good' : 'text-bad'} aria-label={c.passed ? 'passed' : 'failed'}>{c.passed ? '✓' : '✕'}</span>
              <span><span className="font-medium">{c.name}</span> <span className="text-muted">({c.detail})</span></span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
