const { Migration } = require('../models');
const { STATUS, EVENT } = require('../constants');
const { transition } = require('./stateMachine');
const { recordEvent } = require('./eventService');
const { getProvider } = require('../ai');
const { runMigrationAgent } = require('./agentService');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

const ANALYZABLE = [STATUS.DRAFT, STATUS.PLAN_READY, STATUS.REJECTED, STATUS.APPROVED, STATUS.DRY_RUN_COMPLETED, STATUS.FAILED];

/**
 * Asks the AI agent for a plan and stores it as a NEW plan version (older versions are kept, marked SUPERSEDED).
 * Re-analysing after approval revokes the approval: the new plan must be approved again.
 */
async function analyzeMigration(id, { actor = 'user' } = {}) {
  // Atomically claim the migration. Concurrent analyze calls cannot both succeed.
  const claimed = await transition(id, ANALYZABLE, STATUS.ANALYZING, { lastError: null });
  let provider;
  try {
    provider = getProvider();
    const { plan, validation, activity } = await runMigrationAgent({ migration: claimed, provider });

    // Supersede older plans and revoke any prior approval, then store the new version.
    // Plans are append-only and we hold the ANALYZING claim, so index paths are stable.
    const supersede = {};
    claimed.plans.forEach((p, i) => {
      if (p.status === 'PROPOSED' || p.status === 'APPROVED') supersede[`plans.${i}.status`] = 'SUPERSEDED';
    });
    if (Object.keys(supersede).length) await Migration.updateOne({ _id: id }, { $set: supersede });
    const version = claimed.currentPlanVersion + 1;
    const updated = await transition(
      id,
      [STATUS.ANALYZING],
      STATUS.PLAN_READY,
      { currentPlanVersion: version, approvedPlanVersion: null, approval: { approvedBy: null, approvedAt: null, planVersion: null } },
      {
        $push: {
          plans: {
            version,
            createdBy: 'ai',
            createdByLabel: `ai:${provider.label}`,
            basedOnVersion: null,
            createdAt: new Date(),
            ...plan,
            agentActivity: activity,
            validation: { valid: true, problems: [], warnings: validation.warnings },
            status: 'PROPOSED',
          },
        },
      }
    );
    await recordEvent(id, EVENT.ANALYZED, {
      actor: `ai:${provider.label}`,
      planVersion: version,
      message: `AI plan v${version} generated: ${plan.mappings.length} mappings, ${plan.risks.length} risks, ${plan.clarificationQuestions.length} questions.`,
      metadata: { provider: provider.label, mappings: plan.mappings.length, risks: plan.risks.length, requestedBy: actor },
    });
    return updated.toObject();
  } catch (err) {
    const message = err instanceof AppError ? err.message : 'AI analysis failed unexpectedly.';
    if (!(err instanceof AppError)) logger.error('analysis_unexpected_error', { migrationId: String(id), message: err.message });
    await transition(id, [STATUS.ANALYZING], STATUS.FAILED, { lastError: message });
    await recordEvent(id, EVENT.ANALYSIS_FAILED, {
      actor: provider ? `ai:${provider.label}` : 'system',
      message: `AI analysis failed: ${message}`,
      metadata: { code: err.code || 'INTERNAL_ERROR', problems: Array.isArray(err.details) ? err.details.slice(0, 10) : undefined },
    });
    throw err instanceof AppError ? err : new AppError(500, 'ANALYSIS_FAILED', 'AI analysis failed unexpectedly.');
  }
}

module.exports = { analyzeMigration };
