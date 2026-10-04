import { useState } from 'react';
import { fmtDate, compactJson } from '../lib/format.js';
import { Badge, Button, Card, Code, ConfirmDialog, EmptyState, Stat, Table, Td, Th } from './ui.jsx';

export default function DryRunTab({ m, actions, busy, goTo }) {
  const [confirm, setConfirm] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const dry = (m.executions || []).find((e) => e.type === 'DRY_RUN' && e.planVersion === m.approvedPlanVersion);

  if (!m.approvedPlanVersion) {
    return <EmptyState title="Approve a plan first" action={<Button variant="secondary" onClick={() => goTo('plan')}>Go to AI plan</Button>}>A dry run uses the approved plan. The AI plan must be approved by a person before anything is processed.</EmptyState>;
  }
  const canRun = ['APPROVED', 'DRY_RUN_COMPLETED'].includes(m.status);
  const canExecute = m.status === 'DRY_RUN_COMPLETED' && dry;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-sm text-muted">The dry run transforms and validates every record with deterministic code. It does not use the AI and writes nothing to the target.</p>
          <div className="flex gap-2">
            {canRun && <Button variant={dry ? 'secondary' : 'primary'} onClick={actions.dryRun} loading={busy === 'dryrun'}>{dry ? 'Run dry run again' : 'Run dry run'}</Button>}
            {canExecute && <Button onClick={() => setConfirm(true)} disabled={Boolean(busy)}>Execute migration</Button>}
          </div>
        </div>
      </Card>

      {!dry ? (
        <EmptyState title="No dry run yet">Run the dry run to see how many records will be accepted and which will be quarantined.</EmptyState>
      ) : (
        <>
          <p className="text-xs text-muted">Dry run of plan v{dry.planVersion} · {fmtDate(dry.completedAt)}</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Source records" value={dry.sourceCount} />
            <Stat label="Transformed" value={dry.transformedCount} hint="Transformations ran without error" />
            <Stat label="Accepted" value={dry.acceptedCount} tone="good" hint="Will be inserted" />
            <Stat label="Rejected" value={dry.rejectedCount} tone={dry.rejectedCount ? 'bad' : 'neutral'} hint="Will be quarantined" />
          </div>

          <Card title={`Rejected records (${dry.rejectedCount})`} subtitle="Never inserted. Original record and every failing field are kept.">
            {dry.rejectedRecords.length === 0 ? <p className="text-sm text-muted">No records were rejected.</p> : (
              <ul className="space-y-3">
                {dry.rejectedRecords.map((r) => (
                  <li key={r.rowIndex} className="rounded-md border border-line p-3">
                    <div className="mb-2 text-sm font-semibold">Record #{r.rowIndex + 1}</div>
                    <ul className="mb-2 space-y-1">
                      {r.fieldErrors.map((e, i) => (
                        <li key={i} className="flex flex-wrap items-baseline gap-2 text-sm">
                          <code className="font-mono text-xs font-medium">{e.field}</code>
                          <span className="text-bad">{e.message}</span>
                          <Badge tone="bad" className="font-mono">{e.rule}</Badge>
                        </li>
                      ))}
                    </ul>
                    <Code>{compactJson(r.sourceRecord)}</Code>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Accepted records (${dry.acceptedCount})`} subtitle="Shown as they will be written to the target." padded={false}>
            {dry.acceptedRecords.length === 0 ? <p className="p-4 text-sm text-muted">No records were accepted.</p> : (
              <>
                <Table>
                  <thead><tr><Th>Record</Th>{Object.keys(dry.acceptedRecords[0].record).map((k) => <Th key={k}>{k}</Th>)}</tr></thead>
                  <tbody>
                    {(showAll ? dry.acceptedRecords : dry.acceptedRecords.slice(0, 10)).map((a) => (
                      <tr key={a.rowIndex}>
                        <Td className="tnum text-muted">#{a.rowIndex + 1}</Td>
                        {Object.keys(dry.acceptedRecords[0].record).map((k) => <Td key={k} className="font-mono text-xs">{a.record[k] === undefined ? '' : String(a.record[k])}</Td>)}
                      </tr>
                    ))}
                  </tbody>
                </Table>
                {dry.acceptedRecords.length > 10 && (
                  <div className="border-t border-line p-3"><Button variant="ghost" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Show first 10' : `Show all ${dry.acceptedRecords.length}`}</Button></div>
                )}
              </>
            )}
          </Card>
        </>
      )}

      <ConfirmDialog open={confirm} title="Execute migration" confirmLabel="Execute migration" busy={busy === 'execute'}
        onCancel={() => setConfirm(false)} onConfirm={async () => { await actions.execute(); setConfirm(false); }}>
        <p className="font-medium">You are about to migrate {dry ? dry.acceptedCount : 0} accepted records.</p>
        <p className="mt-1">{dry ? dry.rejectedCount : 0} rejected records will be quarantined, not inserted. Executing again later is safe: records already migrated are skipped.</p>
      </ConfirmDialog>
    </div>
  );
}
