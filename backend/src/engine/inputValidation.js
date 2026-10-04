const { badRequest } = require('../utils/errors');
const { validateSchemaShape, isPlainObject, isValidFieldName } = require('./schemaUtils');

function parseMaybeJson(value, label, errors) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    errors.push(`Please provide a valid JSON ${label}.`);
    return undefined;
  }
}

/** Validates and normalizes the payload for creating a migration. Throws a 400 AppError listing every problem. */
function validateMigrationInput(body, maxSampleRecords) {
  const errors = [];
  const b = body || {};
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) errors.push('Migration name is required.');
  else if (name.length > 120) errors.push('Migration name must be 120 characters or fewer.');

  const sourceSchema = parseMaybeJson(b.sourceSchema, 'source schema', errors);
  const targetSchema = parseMaybeJson(b.targetSchema, 'target schema', errors);
  const sampleRecords = parseMaybeJson(b.sampleRecords, 'sample records array', errors);

  if (sourceSchema !== undefined) errors.push(...validateSchemaShape(sourceSchema, 'Source schema'));
  if (targetSchema !== undefined) errors.push(...validateSchemaShape(targetSchema, 'Target schema'));

  if (sampleRecords !== undefined) {
    if (!Array.isArray(sampleRecords) || sampleRecords.length === 0) {
      errors.push('Sample records must be a non-empty JSON array.');
    } else if (sampleRecords.length > maxSampleRecords) {
      errors.push(`Sample records exceed the documented maximum of ${maxSampleRecords} (received ${sampleRecords.length}). This MVP only supports bounded datasets.`);
    } else {
      sampleRecords.forEach((rec, i) => {
        if (!isPlainObject(rec)) errors.push(`Sample record #${i + 1} must be a JSON object.`);
        else if (Object.keys(rec).some((k) => !isValidFieldName(k))) errors.push(`Sample record #${i + 1} has an invalid field name.`);
      });
    }
  }

  if (errors.length) throw badRequest(errors[0], errors);
  return { name, sourceSchema, targetSchema, sampleRecords };
}

module.exports = { validateMigrationInput };
