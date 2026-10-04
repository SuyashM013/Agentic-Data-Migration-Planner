export const fmtDate = (d) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) : '-');
export const shortId = (id) => (id ? String(id).slice(0, 8) : '-');

// label + tone for every migration status
export const STATUS_META = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  ANALYZING: { label: 'Analyzing', tone: 'info' },
  PLAN_READY: { label: 'Plan ready for review', tone: 'warn' },
  APPROVED: { label: 'Approved', tone: 'accent' },
  REJECTED: { label: 'Plan rejected', tone: 'bad' },
  DRY_RUN_COMPLETED: { label: 'Dry run completed', tone: 'accent' },
  EXECUTING: { label: 'Executing', tone: 'info' },
  COMPLETED: { label: 'Completed', tone: 'good' },
  FAILED: { label: 'Failed', tone: 'bad' },
  ROLLED_BACK: { label: 'Rolled back', tone: 'neutral' },
};

export const EVENT_LABEL = {
  migration_created: 'Created',
  migration_analyzed: 'AI plan generated',
  analysis_failed: 'AI analysis failed',
  plan_edited: 'Plan edited by reviewer',
  migration_approved: 'Approved',
  plan_rejected: 'Plan rejected',
  dry_run_started: 'Dry run started',
  dry_run_completed: 'Dry run completed',
  migration_started: 'Executed',
  migration_retried: 'Retried',
  migration_completed: 'Execution completed',
  migration_failed: 'Failed',
  migration_rolled_back: 'Rolled back',
};

export const compactJson = (v) => JSON.stringify(v);
