import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { fmtDate } from '../lib/format.js';
import { Alert, Button, Card, EmptyState, LoadingBlock, Stat, StatusBadge, Table, Td, Th } from '../components/ui.jsx';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const load = () => {
    setError(null);
    api.list().then(setData).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Migrations</h1>
          <p className="text-sm text-muted">AI proposes, you approve, the backend executes.</p>
        </div>
        <Button onClick={() => navigate('/new')}>+ New migration</Button>
      </div>

      {error && <Alert tone="bad" title="Could not load migrations" action={<Button variant="secondary" onClick={load}>Retry</Button>}>{error}</Alert>}
      {!data && !error && <LoadingBlock label="Loading migrations…" />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Total migrations" value={data.stats.total} />
            <Stat label="Drafts" value={data.stats.draft} />
            <Stat label="Pending approval" value={data.stats.pendingApproval} tone={data.stats.pendingApproval ? 'warn' : 'neutral'} />
            <Stat label="Successful" value={data.stats.successful} tone={data.stats.successful ? 'good' : 'neutral'} />
            <Stat label="Rolled back" value={data.stats.rolledBack} />
          </div>

          <Card title="Recent migrations" padded={false}>
            {data.items.length === 0 ? (
              <div className="p-4">
                <EmptyState title="No migrations yet" action={<Button onClick={() => navigate('/new')}>Create your first migration</Button>}>
                  Paste a source schema, a target schema and sample records. You can load the demo dataset on the next screen.
                </EmptyState>
              </div>
            ) : (
              <Table>
                <thead><tr><Th>Name</Th><Th>Status</Th><Th className="text-right">Records</Th><Th>Plan version</Th><Th>Updated</Th></tr></thead>
                <tbody>
                  {data.items.slice(0, 15).map((m) => (
                    <tr key={m._id} className="hover:bg-paper/60">
                      <Td><Link className="font-medium text-accent hover:underline" to={`/migrations/${m._id}`}>{m.name}</Link></Td>
                      <Td><StatusBadge status={m.status} /></Td>
                      <Td className="tnum text-right">{m.sampleCount}</Td>
                      <Td>{m.currentPlanVersion ? `v${m.currentPlanVersion}` : '-'}</Td>
                      <Td className="text-muted">{fmtDate(m.updatedAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
