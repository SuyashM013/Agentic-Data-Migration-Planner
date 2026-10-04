const { createToolbox } = require('../tools');
const { SYSTEM_PROMPT, buildUserPrompt, buildRepairPrompt } = require('../prompts/migrationAgentPrompt');
const { extractJson } = require('../ai/extractJson');
const { validatePlan } = require('../engine/planValidator');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

const MAX_TURNS = 10;
const MAX_TOOL_CALLS = 14;
const MAX_REPAIRS = 1;

const summarize = (name, result) => {
  if (name === 'validateMapping') return result.valid ? 'Proposed mappings are valid' : `${result.problems.length} problem(s) found`;
  if (name === 'inspectSampleRecords') return `${result.returned} of ${result.totalRecords} records inspected`;
  if (result.fields) return `${result.fields.length} fields`;
  if (result.transformations) return `${result.transformations.length} transformations available`;
  return result.error || 'done';
};

/**
 * Runs the tool-using planning loop. The model can only call read-only tools. Its final JSON is parsed and then
 * validated by the deterministic plan validator; invalid output gets at most one repair round, then fails.
 * Returns { plan, validation, activity, provider }. Never touches the database.
 */
async function runMigrationAgent({ migration, provider }) {
  const toolbox = createToolbox(migration);
  const ctx = { migrationId: String(migration._id), provider: provider.label };
  const activity = [];
  const log = (step, tool, status, summary) => activity.push({ step, tool, status, summary, at: new Date() });

  logger.info('agent_started', ctx);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt({ name: migration.name, sampleCount: migration.sampleRecords.length }) },
  ];

  let toolCallCount = 0;
  let repairs = 0;
  let lastProblems = [];

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const reply = await provider.chat({ messages, tools: toolbox.definitions });
    messages.push({ role: 'assistant', content: reply.content, toolCalls: reply.toolCalls, native: reply.native });

    if (reply.toolCalls && reply.toolCalls.length) {
      for (const call of reply.toolCalls) {
        toolCallCount += 1;
        logger.info('tool_called', { ...ctx, tool: call.name });
        if (toolCallCount > MAX_TOOL_CALLS) {
          throw new AppError(502, 'AI_AGENT_ERROR', 'The AI agent made too many tool calls and was stopped.');
        }
        const out = toolbox.execute(call.name, call.args);
        logger.info('tool_completed', { ...ctx, tool: call.name, ok: out.ok });
        log(out.refused ? `Refused unknown tool "${call.name}"` : toolbox.stepLabel(call.name), call.name, out.ok ? 'ok' : 'error', out.ok ? summarize(call.name, out.result) : out.result.error);
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify(out.result) });
      }
      continue;
    }

    // No tool calls: this is the model's final answer. Parse, then validate deterministically.
    const parsed = extractJson(reply.content);
    const validation = parsed === undefined
      ? { valid: false, problems: ['Reply was not a valid JSON object.'], warnings: [], plan: null }
      : validatePlan(parsed, migration.sourceSchema, migration.targetSchema);

    if (validation.valid) {
      log('Backend validated the generated plan', 'validatePlan', 'ok', `${validation.plan.mappings.length} mappings accepted${validation.warnings.length ? `, ${validation.warnings.length} warning(s)` : ''}`);
      log('Generated migration plan', null, 'ok', 'Structured plan ready for human review');
      logger.info('plan_generated', { ...ctx, mappings: validation.plan.mappings.length, toolCalls: toolCallCount });
      return { plan: validation.plan, validation, activity, provider: provider.label };
    }

    lastProblems = validation.problems;
    logger.warn('plan_validation_failed', { ...ctx, problems: validation.problems.slice(0, 10), attempt: repairs + 1 });
    log('Backend rejected the generated plan', 'validatePlan', 'error', `${validation.problems.length} problem(s)${repairs < MAX_REPAIRS ? '; asking the agent to repair' : ''}`);
    if (repairs >= MAX_REPAIRS) break;
    repairs += 1;
    messages.push({ role: 'user', content: buildRepairPrompt(validation.problems) });
  }

  if (!lastProblems.length) {
    throw new AppError(502, 'AI_AGENT_ERROR', 'The AI agent did not return a final plan within the allowed number of steps.');
  }
  throw new AppError(422, 'AI_PLAN_INVALID', 'The AI produced a plan that failed backend validation, so it was discarded.', lastProblems);
}

module.exports = { runMigrationAgent };
