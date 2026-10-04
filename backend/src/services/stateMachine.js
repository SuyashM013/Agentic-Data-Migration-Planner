const mongoose = require('mongoose');
const { Migration } = require('../models');
const { TRANSITIONS } = require('../constants');
const { notFound, conflict } = require('../utils/errors');

function assertObjectId(id) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Migration not found');
}

function canTransition(from, to) {
  return Boolean(TRANSITIONS[from] && TRANSITIONS[from].includes(to));
}

/**
 * Atomic, compare-and-set state transition.
 * Only succeeds if the migration is currently in one of `fromStates` AND that transition is legal.
 * Because the check happens inside findOneAndUpdate, two concurrent requests cannot both win.
 */
async function transition(migrationId, fromStates, to, extraSet = {}, extraOps = {}, guard = {}) {
  assertObjectId(migrationId);
  const legalFrom = fromStates.filter((f) => canTransition(f, to));
  const doc = legalFrom.length
    ? await Migration.findOneAndUpdate({ _id: migrationId, status: { $in: legalFrom }, ...guard }, { $set: { status: to, ...extraSet }, ...extraOps }, { new: true })
    : null;
  if (doc) return doc;

  const current = await Migration.findById(migrationId).select('status');
  if (!current) throw notFound('Migration not found');
  throw conflict(`Invalid state transition: ${current.status} → ${to}. This action is not allowed while the migration is ${current.status}.`, 'INVALID_STATE', {
    currentStatus: current.status,
    requestedStatus: to,
  });
}

module.exports = { transition, canTransition, assertObjectId };
