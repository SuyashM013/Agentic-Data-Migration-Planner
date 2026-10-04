const { Migration } = require('../models');
const { STATUS, EVENT } = require('../constants');
const { transition } = require('./stateMachine');
const { recordEvent } = require('./eventService');
const { getMigration } = require('./migrationService');
const { validatePlan } = require('../engine/planValidator');
const { badRequest, conflict } = require('../utils/errors');
const logger = require('../utils/logger');

const cleanActor = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : fallback);
const sig = (mappings) => JSON.stringify(mappings.map((m) => [m.sourceField, m.targetField, m.transformation]).sort());

/**
 * Human approval gate. Only this endpoint can move a migration to APPROVED - the AI has no path here.
 * If the reviewer supplies edited mappings, the edit is validated and stored as a NEW plan version (created by "user").
 */
async function approvePlan(id, body = {}) {
  const migration = await getMigration(id);
  if (migration.status !== STATUS.PLAN_READY) {
    throw conflict(`Only a migration with a ready plan can be approved (current status: ${migration.status}).`, 'INVALID_STATE', { currentStatus: migration.status });
  }
  const actor = cleanActor(body.approvedBy, 'reviewer');
  const idx = migration.plans.findIndex((p) => p.version === migration.currentPlanVersion);
  const current = migration.plans[idx];
  const now = new Date();
  let approvedVersion = current.version;

  const edited = Array.isArray(body.mappings) && sig(body.mappings) !== sig(current.mappings);
  if (edited) {
    const check = validatePlan(
      { mappings: body.mappings.map((m) => ({ ...m, reason: m.reason || 'Edited by reviewer', confidence: m.confidence || 'high' })), risks: current.risks.filter((r) => r.source === 'ai'), clarificationQuestions: current.clarificationQuestions },
      migration.sourceSchema,
      migration.targetSchema
    );
    if (!check.valid) throw badRequest('The edited mappings are not valid.', check.problems, 'PLAN_INVALID');
    approvedVersion = migration.currentPlanVersion + 1;
    await transition(
      id,
      [STATUS.PLAN_READY],
      STATUS.APPROVED,
      { currentPlanVersion: approvedVersion, approvedPlanVersion: approvedVersion, approval: { approvedBy: actor, approvedAt: now, planVersion: approvedVersion } },
      {
        $push: {
          plans: {
            version: approvedVersion,
            createdBy: 'user',
            createdByLabel: `user:${actor}`,
            basedOnVersion: current.version,
            createdAt: now,
            ...check.plan,
            agentActivity: [],
            validation: { valid: true, problems: [], warnings: check.warnings },
            status: 'APPROVED',
            approvedBy: actor,
            approvedAt: now,
          },
        },
      },
      { currentPlanVersion: migration.currentPlanVersion }
    );
    await Migration.updateOne({ _id: id }, { $set: { [`plans.${idx}.status`]: 'SUPERSEDED' } });
    await recordEvent(id, EVENT.PLAN_EDITED, {
      actor: `user:${actor}`,
      planVersion: approvedVersion,
      message: `Reviewer edited the mappings; saved as plan v${approvedVersion} (based on v${current.version}).`,
      metadata: { basedOnVersion: current.version },
    });
    return finishApproval(id, actor, approvedVersion);
  }

  await transition(
    id,
    [STATUS.PLAN_READY],
    STATUS.APPROVED,
    {
      approvedPlanVersion: approvedVersion,
      approval: { approvedBy: actor, approvedAt: now, planVersion: approvedVersion },
      [`plans.${idx}.status`]: 'APPROVED',
      [`plans.${idx}.approvedBy`]: actor,
      [`plans.${idx}.approvedAt`]: now,
    },
    {},
    { currentPlanVersion: migration.currentPlanVersion }
  );
  return finishApproval(id, actor, approvedVersion);
}

async function finishApproval(id, actor, version) {
  logger.info('plan_approved', { migrationId: String(id), planVersion: version, approvedBy: actor });
  await recordEvent(id, EVENT.APPROVED, { actor: `user:${actor}`, planVersion: version, message: `Plan v${version} approved by ${actor}.`, metadata: { approvedBy: actor } });
  return getMigration(id);
}

async function rejectPlan(id, body = {}) {
  const migration = await getMigration(id);
  const actor = cleanActor(body.rejectedBy, 'reviewer');
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  const idx = migration.plans.findIndex((p) => p.version === migration.currentPlanVersion);
  await transition(id, [STATUS.PLAN_READY], STATUS.REJECTED, {
    [`plans.${idx}.status`]: 'REJECTED',
    [`plans.${idx}.rejectedAt`]: new Date(),
    [`plans.${idx}.rejectionReason`]: reason || null,
  }, {}, { currentPlanVersion: migration.currentPlanVersion });
  await recordEvent(id, EVENT.REJECTED, {
    actor: `user:${actor}`,
    planVersion: migration.currentPlanVersion,
    message: `Plan v${migration.currentPlanVersion} rejected${reason ? `: ${reason}` : '.'}`,
    metadata: { reason },
  });
  return getMigration(id);
}

module.exports = { approvePlan, rejectPlan };
