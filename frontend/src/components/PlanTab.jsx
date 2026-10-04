import { useEffect, useState } from 'react';
import { fmtDate } from '../lib/format.js';
import { Alert, Badge, Button, Card, ConfidenceBadge, ConfirmDialog, EmptyState, SeverityBadge, Table, Td, Th } from './ui.jsx';

const PLAN_TONE = { PROPOSED: 'warn', APPROVED: 'good', REJECTED: 'bad', SUPERSEDED: 'neutral' };

export default function PlanTab({ m, actions, busy, transformations, viewVersion, setViewVersion }) {
  const version = viewVersion || m.currentPlanVersion;
  const plan = m.plans.find((p) => p.version === version);
  const isCurrent = version === m.currentPlanVersion;
  const canReview = m.status === 'PLAN_READY' && isCurrent;
  const [edits, setEdits] = useState({});
  const [dialog, setDialog] = useState(null); // 'approve' | 'reject'
  const [approver, setApprover] = useState('reviewer');
  const [reason, setReason] = useState('');
  useEffect(() => setEdits({}), [version, m.updatedAt]);

  const analyzeCta = ['DRAFT', 'FAILED', 'REJECTED'].includes(m.status);
  if (!plan) {
    return (
      <EmptyState title="No AI plan yet" action={analyzeCta && <Button onClick={actions.analyze} loading={busy === 'analyze'}>Analyze with AI</Button>}>
        {m.status === 'FAILED' ? 'The last analysis failed. Retrying creates the first plan version.' : 'Run the analysis to let the agent inspect your schemas and sample records.'}
      </EmptyState>
    );
  }

  const mappings = plan.mappings.map((x) => ({ ...x, transformation: edits[x.targetField] || x.transformation }));
  const edited = Object.keys(edits).length > 0;
  const approveBody = { approvedBy: approver.trim() || 'reviewer', ...(edited ? { mappings } : {}) };

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label htmlFor="ver" className="font-medium">Plan version</label>
            <select id="ver" value={version} onChange={(e) => setViewVersion(Number(e.target.value))} className="rounded-md border border-line bg-surface px-2 py-1.5">
              {m.plans.map((p) => <option key={p.version} value={p.version}>v{p.version} · {p.createdBy === 'ai' ? 'AI generated' : 'edited by user'} · {p.status.toLowerCase()}</option>)}
            </select>
            <Badge tone={PLAN_TONE[plan.status]}>{plan.status.toLowerCase()}</Badge>
            <span className="text-muted">by {plan.createdByLabel} · {fmtDate(plan.createdAt)}{plan.basedOnVersion ? ` · based on v${plan.basedOnVersion}` : ''}</span>
          </div>
          {analyzeCta && <Button variant="secondary" onClick={actions.analyze} loading={busy === 'analyze'}>Regenerate plan</Button>}
        </div>
        {plan.status === 'APPROVED' && <p className="mt-3 text-sm text-good">Approved by {plan.approvedBy} on {fmtDate(plan.approvedAt)}.</p>}
        {plan.status === 'REJECTED' && <p className="mt-3 text-sm text-bad">Rejected on {fmtDate(plan.rejectedAt)}{plan.rejectionReason ? `: ${plan.rejectionReason}` : '.'}</p>}
        {!isCurrent && <p className="mt-3 text-sm text-muted">You are viewing an earlier version. It is read-only.</p>}
      </Card>

      <Card title="Field mapping" subtitle={canReview ? 'You can change a transformation before approving. Edits are saved as a new plan version.' : undefined} padded={false}>
        <Table>
          <thead><tr><Th>Source field</Th><Th>Target field</Th><Th>Transformation</Th><Th>Confidence</Th><Th>Reason</Th></tr></thead>
          <tbody>
            {mappings.map((x) => (
              <tr key={x.targetField}>
                <Td className="font-mono text-xs">{x.sourceField}</Td>
                <Td className="font-mono text-xs">→ {x.targetField}</Td>
                <Td>
                  {canReview ? (
                    <select aria-label={`Transformation for ${x.targetField}`} value={x.transformation} onChange={(e) => setEdits((s) => ({ ...s, [x.targetField]: e.target.value }))}
                      className={`rounded-md border bg-surface px-2 py-1 font-mono text-xs ${edits[x.targetField] ? 'border-accent' : 'border-line'}`}>
                      {transformations.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  ) : <code className="font-mono text-xs">{x.transformation}</code>}
                </Td>
                <Td><ConfidenceBadge level={x.confidence} /></Td>
                <Td className="max-w-sm text-muted">{x.reason}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card title="Unmapped fields">
          <div className="space-y-3 text-sm">
            <div><div className="mb-1 font-medium">Source fields not migrated</div>{plan.unmappedSourceFields.length ? <div className="flex flex-wrap gap-1.5">{plan.unmappedSourceFields.map((f) => <Badge key={f} tone="warn" className="font-mono">{f}</Badge>)}</div> : <span className="text-muted">None</span>}</div>
            <div><div className="mb-1 font-medium">Target fields with no source</div>{plan.unmappedTargetFields.length ? <div className="flex flex-wrap gap-1.5">{plan.unmappedTargetFields.map((f) => <Badge key={f} tone="warn" className="font-mono">{f}</Badge>)}</div> : <span className="text-muted">None</span>}</div>
          </div>
        </Card>
        <Card title="Agent activity" subtitle="Read-only tools the agent used, then the backend validator.">
          {plan.agentActivity.length === 0 ? <p className="text-sm text-muted">This version was authored by a person, so no agent ran.</p> : (
            <ul className="space-y-1 text-sm">
              {plan.agentActivity.map((a, i) => (
                <li key={i} className="flex gap-2"><span className={a.status === 'ok' ? 'text-good' : 'text-bad'} aria-label={a.status === 'ok' ? 'done' : 'problem'}>{a.status === 'ok' ? '✓' : '✕'}</span><span>{a.step}{a.summary && <span className="text-muted"> ({a.summary})</span>}</span></li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Card title="Risks" subtitle="From the agent and from deterministic backend checks.">
          {plan.risks.length === 0 ? <p className="text-sm text-muted">No risks reported.</p> : (
            <ul className="space-y-2 text-sm">
              {plan.risks.map((r, i) => (
                <li key={i} className="flex items-start gap-2"><SeverityBadge level={r.severity} /><span>{r.message} <span className="text-xs text-muted">({r.source === 'ai' ? 'agent' : 'backend check'})</span></span></li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Clarification questions">
          {plan.clarificationQuestions.length === 0 ? <p className="text-sm text-muted">The agent has no open questions.</p> : (
            <ul className="list-disc space-y-1.5 pl-5 text-sm">{plan.clarificationQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul>
          )}
        </Card>
      </div>

      {plan.validation.warnings.length > 0 && <Alert tone="warn" title="Validator warnings">{plan.validation.warnings.join(' ')}</Alert>}

      {canReview && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-sm text-muted">The agent cannot approve its own plan. Nothing is dry-run or executed until you approve.</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setDialog('reject')} disabled={Boolean(busy)}>Reject / regenerate</Button>
              <Button onClick={() => setDialog('approve')} disabled={Boolean(busy)}>{edited ? 'Save edits and approve' : 'Approve plan'}</Button>
            </div>
          </div>
        </Card>
      )}

      <ConfirmDialog open={dialog === 'approve'} title={edited ? `Approve edited plan (new version v${m.currentPlanVersion + 1})?` : `Approve plan v${version}?`} confirmLabel="Approve plan" busy={busy === 'approve'}
        onCancel={() => setDialog(null)} onConfirm={async () => { await actions.approve(approveBody); setDialog(null); }}>
        <p>You are approving {mappings.length} field mappings for dry run and execution.{plan.unmappedTargetFields.length ? ` ${plan.unmappedTargetFields.length} target field(s) will stay empty.` : ''}</p>
        <label htmlFor="approver" className="mt-3 block text-xs font-medium">Approved by</label>
        <input id="approver" value={approver} onChange={(e) => setApprover(e.target.value)} maxLength={80} className="mt-1 w-full rounded-md border border-line px-3 py-1.5 text-sm" />
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'reject'} title="Reject this plan and generate a new one?" confirmLabel="Reject and regenerate" tone="danger" busy={busy === 'reject' || busy === 'analyze'}
        onCancel={() => setDialog(null)} onConfirm={async () => { await actions.reject(reason); setDialog(null); setReason(''); }}>
        <p>This version stays in the history as rejected. The agent will analyze again and you will need to approve the new plan.</p>
        <label htmlFor="reason" className="mt-3 block text-xs font-medium">Reason (optional)</label>
        <textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} className="mt-1 w-full rounded-md border border-line px-3 py-1.5 text-sm" />
      </ConfirmDialog>
    </div>
  );
}
