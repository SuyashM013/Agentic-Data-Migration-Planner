const STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  ANALYZING: 'ANALYZING',
  PLAN_READY: 'PLAN_READY',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  DRY_RUN_COMPLETED: 'DRY_RUN_COMPLETED',
  EXECUTING: 'EXECUTING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  ROLLED_BACK: 'ROLLED_BACK',
});

// Allowed transitions. Anything not listed is rejected by the state machine.
const TRANSITIONS = Object.freeze({
  DRAFT: ['ANALYZING'],
  ANALYZING: ['PLAN_READY', 'FAILED'],
  PLAN_READY: ['APPROVED', 'REJECTED', 'ANALYZING'],
  REJECTED: ['ANALYZING'],
  APPROVED: ['DRY_RUN_COMPLETED', 'ANALYZING'],
  DRY_RUN_COMPLETED: ['DRY_RUN_COMPLETED', 'EXECUTING', 'ANALYZING'],
  EXECUTING: ['COMPLETED', 'FAILED'],
  COMPLETED: ['EXECUTING', 'ROLLED_BACK'], // COMPLETED -> EXECUTING is a retry (idempotent)
  FAILED: ['ANALYZING', 'EXECUTING'], // FAILED -> EXECUTING only if approved plan + dry run still exist (service guard)
  ROLLED_BACK: ['ROLLED_BACK'], // self-transition = idempotent re-run of rollback cleanup (service-guarded: only if target records remain)
});

const SCHEMA_TYPES = Object.freeze(['string', 'number', 'boolean', 'date']);
const CONFIDENCE = Object.freeze(['high', 'medium', 'low']);

// Fixed whitelist. The LLM may only choose from these names; implementations live in engine/transformations.js
const SUPPORTED_TRANSFORMATIONS = Object.freeze([
  { name: 'none', description: 'Copy the value unchanged.', input: 'any', output: 'same as input' },
  { name: 'trim', description: 'Remove leading/trailing whitespace.', input: 'string', output: 'string' },
  { name: 'lowercase', description: 'Convert to lower case.', input: 'string', output: 'string' },
  { name: 'uppercase', description: 'Convert to upper case.', input: 'string', output: 'string' },
  { name: 'normalize_phone', description: 'Strip spaces, dashes, brackets and "+"; keep digits only (e.g. "+91 98765-43210" -> "919876543210").', input: 'string', output: 'string' },
  { name: 'string_to_number', description: 'Parse a numeric string (e.g. "42", "3.5") into a number. Fails for non-numeric text.', input: 'string', output: 'number' },
  { name: 'number_to_string', description: 'Convert a number into its string form.', input: 'number', output: 'string' },
  { name: 'date_format', description: 'Convert DD/MM/YYYY, DD-MM-YYYY, YYYY/MM/DD or ISO dates to ISO YYYY-MM-DD.', input: 'string', output: 'date' },
]);
const TRANSFORMATION_NAMES = Object.freeze(SUPPORTED_TRANSFORMATIONS.map((t) => t.name));

const EVENT = Object.freeze({
  CREATED: 'migration_created',
  ANALYZED: 'migration_analyzed',
  ANALYSIS_FAILED: 'analysis_failed',
  PLAN_EDITED: 'plan_edited',
  APPROVED: 'migration_approved',
  REJECTED: 'plan_rejected',
  DRY_RUN_STARTED: 'dry_run_started',
  DRY_RUN_COMPLETED: 'dry_run_completed',
  STARTED: 'migration_started',
  COMPLETED: 'migration_completed',
  RETRIED: 'migration_retried',
  FAILED: 'migration_failed',
  ROLLED_BACK: 'migration_rolled_back',
});

module.exports = { STATUS, TRANSITIONS, SCHEMA_TYPES, CONFIDENCE, SUPPORTED_TRANSFORMATIONS, TRANSFORMATION_NAMES, EVENT };
