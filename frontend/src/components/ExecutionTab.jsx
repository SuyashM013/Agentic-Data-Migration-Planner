import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtDate, shortId } from '../lib/format.js';
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Stat, Table, Td, Th } from './ui.jsx';

const EXEC_TONE = { COMPLETED: 'good', FAILED: 'bad', RUNNING: 'info', ROLLED_BACK: 'neutral' };

export default function ExecutionTab({ m, actions, busy, goTo }) {
  const [dialog, setDialog] = useState(null);
  const [target, setTarget] = useState(null);
  const runs = (m.executions || []).filter((e) => e.type === 'EXECUTION');
  const latest = runs[0];

  useEffect(() => {
    if (runs.length === 0) return;
    api.targetRecords(m._id).then(setTarget).catch(() => setTarget(null));
  }, [m._id, m.updatedAt, runs.length]);

  if (runs.length === 0) {
    return (
      <EmptyState title="Not executed yet" action={m.status === 'DRY_RUN_COMPLETED' ? <Button onClick={() => goTo('dryrun')}>Review dry run and execute</Button> : null}>
        Execution requires an approved plan and a completed dry run.
      </EmptyState>
    );
  }
  const initial = runs.filter((r) => !r.isRetry && r.status !== 'FAILED').slice(-1)[0] || latest;
  const canAct = ['COMPLETED'].includes(m.status);

  return (
    <div className="space-y-5">
      {latest.status === 'FAILED' && <Alert tone="bad" title={latest.isRetry ? 'Retry failed. Previously migrated records are unchanged.' : 'Migration failed. No target records were inserted.'}>{latest.error}</Alert>}
      {m.status === 'ROLLED_BACK' && <Alert tone="info" title="This migration was rolled back">Only records created by this migration were removed. Quarantine evidence and history are preserved.</Alert>}

      <Card title="Latest execution" subtitle={`${latest.isRetry ? 'Retry' : 'Initial run'} · ${fmtDate(latest.completedAt || latest.startedAt)} · ${shortId(latest.executionId)}`}
        actions={<Badge tone={EXEC_TONE[latest.status]}>{latest.status.toLowerCase().replace('_', ' ')}</Badge>}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Inserted records" value={latest.insertedCount} tone="good" />
          <Stat label="Rejected records" value={latest.rejectedCount} tone={latest.rejectedCount ? 'bad' : 'neutral'} hint="Quarantined" />
          <Stat label="Duplicates skipped" value={latest.duplicateCount} hint="Already migrated" />
          <Stat label="Accepted by dry run" value={latest.acceptedCount} />
        </div>
        {canAct && (
          <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            <Button variant="secondary" onClick={() => setDialog('retry')} disabled={Boolean(busy)}>Retry execution</Button>
            <Button variant="danger" onClick={() => setDialog('rollback')} disabled={Boolean(busy)}>Roll back migration</Button>
          </div>
        )}
        {m.status === 'FAILED' && <div className="mt-4 flex justify-end border-t border-line pt-4"><Button onClick={() => setDialog('retry')} disabled={Boolean(busy)}>Execute again</Button></div>}
      </Card>

      <Card title="Execution attempts" padded={false}>
        <Table>
          <thead><tr><Th>Execution</Th><Th>Kind</Th><Th>Status</Th><Th className="text-right">Inserted</Th><Th className="text-right">Duplicates</Th><Th className="text-right">Rejected</Th><Th>Started</Th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.executionId}>
                <Td className="font-mono text-xs">{shortId(r.executionId)}</Td>
                <Td>{r.isRetry ? 'Retry' : 'Initial'}</Td>
                <Td><Badge tone={EXEC_TONE[r.status]}>{r.status.toLowerCase().replace('_', ' ')}</Badge></Td>
                <Td className="tnum text-right">{r.insertedCount}</Td>
                <Td className="tnum text-right">{r.duplicateCount}</Td>
                <Td className="tnum text-right">{r.rejectedCount}</Td>
                <Td className="text-muted">{fmtDate(r.startedAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card title={`Mock target store${target ? ` (${target.total} records)` : ''}`} subtitle="Records created by this migration, as written by the backend." padded={false}>
        {!target || target.total === 0 ? <p className="p-4 text-sm text-muted">{target ? 'The target store holds no records for this migration.' : 'Loading target records…'}</p> : (
          <Table>
            <thead><tr><Th>Source id</Th>{Object.keys(target.items[0].data).map((k) => <Th key={k}>{k}</Th>)}</tr></thead>
            <tbody>
              {target.items.slice(0, 10).map((t) => (
                <tr key={t._id}><Td className="font-mono text-xs text-muted">{t.sourceRecordId}</Td>{Object.keys(target.items[0].data).map((k) => <Td key={k} className="font-mono text-xs">{t.data[k] === undefined ? '' : String(t.data[k])}</Td>)}</tr>
              ))}
            </tbody>
          </Table>
        )}
        {target && target.total > 10 && <p className="border-t border-line p-3 text-xs text-muted">Showing the first 10 of {target.total}.</p>}
      </Card>

      <ConfirmDialog open={dialog === 'retry'} title="Retry execution" confirmLabel="Retry execution" busy={busy === 'execute'}
        onCancel={() => setDialog(null)} onConfirm={async () => { await actions.execute(); setDialog(null); }}>
        <p>Retrying is safe. Each record has an idempotency key (migration id + source record id), so records that were already inserted are skipped, not duplicated.</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'rollback'} title="Roll back this migration?" confirmLabel="Roll back" tone="danger" busy={busy === 'rollback'}
        onCancel={() => setDialog(null)} onConfirm={async () => { await actions.rollback(); setDialog(null); }}>
        <p>This removes the {initial.insertedCount} records this migration inserted into the target store, and only those. Quarantine records, executions and history are kept. A rolled-back migration cannot be executed again.</p>
      </ConfirmDialog>
    </div>
  );
}
