import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { EVENT_LABEL, fmtDate } from '../lib/format.js';
import { Alert, Badge, Button, Card, LoadingBlock, Table, Td, Th } from './ui.jsx';

const TONE = { migration_failed: 'bad', analysis_failed: 'bad', plan_rejected: 'bad', migration_rolled_back: 'neutral', migration_completed: 'good', migration_approved: 'good', migration_retried: 'info' };

export default function HistoryTab({ m, onViewPlan }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    setError(null);
    api.history(m._id).then(setData).catch((e) => setError(e.message));
  }, [m._id, m.updatedAt]);

  if (error) return <Alert tone="bad" title="Could not load history">{error}</Alert>;
  if (!data) return <LoadingBlock label="Loading history…" />;

  return (
    <div className="space-y-5">
      <Card title="Lifecycle" subtitle="Append-only. Events are never edited or removed, including after a rollback.">
        <ol className="relative ml-2 space-y-4 border-l border-line pl-5">
          {data.events.map((e) => (
            <li key={e._id} className="relative">
              <span className="absolute -left-[25px] top-1.5 size-2.5 rounded-full bg-accent ring-4 ring-surface" aria-hidden="true" />
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={TONE[e.type] || 'accent'}>{EVENT_LABEL[e.type] || e.type}</Badge>
                {e.planVersion && <span className="text-xs text-muted">plan v{e.planVersion}</span>}
                <span className="text-xs text-muted">{fmtDate(e.createdAt)} · {e.actor}</span>
              </div>
              <p className="mt-1 text-sm">{e.message}</p>
              {e.executionId && <p className="font-mono text-xs text-muted">execution {e.executionId.slice(0, 8)}</p>}
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Plan versions" subtitle="Each version is kept; editing or regenerating never overwrites a previous plan." padded={false}>
        {data.planVersions.length === 0 ? <p className="p-4 text-sm text-muted">No plan has been generated yet.</p> : (
          <Table>
            <thead><tr><Th>Version</Th><Th>Created by</Th><Th>Created</Th><Th>Mappings</Th><Th>Status</Th><Th>Approved by</Th><Th> </Th></tr></thead>
            <tbody>
              {data.planVersions.map((p) => (
                <tr key={p.version}>
                  <Td className="font-medium">v{p.version}</Td>
                  <Td className="font-mono text-xs">{p.createdByLabel}</Td>
                  <Td className="text-muted">{fmtDate(p.createdAt)}</Td>
                  <Td className="tnum">{p.mappingCount}</Td>
                  <Td><Badge tone={{ PROPOSED: 'warn', APPROVED: 'good', REJECTED: 'bad', SUPERSEDED: 'neutral' }[p.status]}>{p.status.toLowerCase()}</Badge></Td>
                  <Td>{p.approvedBy ? `${p.approvedBy} · ${fmtDate(p.approvedAt)}` : '-'}</Td>
                  <Td><Button variant="ghost" className="!py-1" onClick={() => onViewPlan(p.version)}>View plan</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
