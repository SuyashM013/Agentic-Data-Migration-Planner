import { Fragment, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { compactJson, shortId } from '../lib/format.js';
import { Alert, Badge, Button, Card, EmptyState, LoadingBlock, Table, Td, Th } from './ui.jsx';

export default function QuarantineTab({ m, goTo }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    setError(null);
    api.quarantine(m._id).then(setData).catch((e) => setError(e.message));
  }, [m._id, m.updatedAt]);

  if (error) return <Alert tone="bad" title="Could not load quarantine">{error}</Alert>;
  if (!data) return <LoadingBlock label="Loading quarantine…" />;
  if (data.total === 0) {
    return (
      <EmptyState title="Quarantine is empty" action={m.status === 'DRY_RUN_COMPLETED' ? <Button variant="secondary" onClick={() => goTo('dryrun')}>See rejected records in the dry run</Button> : null}>
        Rejected records are written here when the migration is executed. Before that, they appear in the dry run.
      </EmptyState>
    );
  }
  return (
    <Card title={`${data.total} quarantined records`} subtitle="Never inserted into the target. The original source record is preserved exactly as received." padded={false}>
      <Table>
        <thead><tr><Th>Record</Th><Th>Source record</Th><Th>Error field</Th><Th>Error message</Th><Th>Migration</Th><Th>Execution</Th></tr></thead>
        <tbody>
          {data.items.map((q) => (
            <Fragment key={q._id}>
              {q.fieldErrors.map((e, i) => (
                <tr key={i}>
                  {i === 0 && (
                    <>
                      <Td rowSpan={q.fieldErrors.length} className="whitespace-nowrap"><div className="font-medium">#{q.rowIndex + 1}</div><div className="font-mono text-xs text-muted">id {q.sourceRecordId}</div></Td>
                      <Td rowSpan={q.fieldErrors.length} className="max-w-xs"><code className="block break-words font-mono text-xs">{compactJson(q.sourceRecord)}</code></Td>
                    </>
                  )}
                  <Td className="font-mono text-xs">{e.field}</Td>
                  <Td>{e.message} <Badge tone="bad" className="ml-1 font-mono">{e.rule}</Badge></Td>
                  {i === 0 && (
                    <>
                      <Td rowSpan={q.fieldErrors.length} className="font-mono text-xs text-muted">{shortId(q.migrationId)}</Td>
                      <Td rowSpan={q.fieldErrors.length} className="font-mono text-xs text-muted">{shortId(q.executionId)}</Td>
                    </>
                  )}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
