const STEPS = ['Created', 'Plan ready', 'Approved', 'Dry run', 'Executed', 'Rolled back'];

function progress(m) {
  const ex = m.executions || [];
  const dry = ex.some((e) => e.type === 'DRY_RUN' && e.planVersion === m.approvedPlanVersion);
  const executed = ['COMPLETED', 'ROLLED_BACK'].includes(m.status);
  return [
    true,
    (m.plans || []).length > 0,
    Boolean(m.approvedPlanVersion) || executed,
    dry || executed,
    executed,
    m.status === 'ROLLED_BACK',
  ];
}

/** Lifecycle rail: shows how far this migration has progressed; it mirrors the backend state machine. */
export default function Stepper({ migration }) {
  const done = progress(migration);
  const current = done.lastIndexOf(true) + 1;
  const failed = migration.status === 'FAILED' || migration.status === 'REJECTED';
  return (
    <ol className="flex flex-wrap items-center gap-y-2 text-sm" aria-label="Migration lifecycle">
      {STEPS.map((label, i) => {
        const isDone = done[i];
        const isCurrent = i === current && !done[STEPS.length - 1];
        const tone = isDone ? 'bg-accent text-white' : isCurrent && failed ? 'bg-bad text-white' : isCurrent ? 'bg-warn-soft text-warn ring-1 ring-warn/40' : 'bg-paper text-muted ring-1 ring-line';
        return (
          <li key={label} className="flex items-center" aria-current={isCurrent ? 'step' : undefined}>
            <span className={`flex size-5 items-center justify-center rounded-full text-[11px] font-semibold ${tone}`} aria-hidden="true">
              {isDone ? '✓' : isCurrent && failed ? '!' : ''}
            </span>
            <span className={`ml-2 ${isDone ? 'text-ink' : isCurrent ? 'font-medium text-ink' : 'text-muted'}`}>{label}</span>
            {i < STEPS.length - 1 && <span className={`mx-3 h-px w-6 sm:w-10 ${done[i + 1] ? 'bg-accent' : 'bg-line'}`} aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
