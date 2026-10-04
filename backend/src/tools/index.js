/**
 * The ONLY capabilities the agent has. All tools are read-only: they return data about the migration input
 * or run the deterministic plan validator. None of them can write to the database or run code.
 */
const { SUPPORTED_TRANSFORMATIONS } = require('../constants');
const { normalizeSchema } = require('../engine/schemaUtils');
const { validatePlan } = require('../engine/planValidator');
const { isMissing } = require('../engine/validators');

const TOOL_DEFINITIONS = [
  { name: 'inspectSourceSchema', description: 'Returns the source schema: field names, types and whether each is required.', parameters: null },
  { name: 'inspectTargetSchema', description: 'Returns the target schema: field names, types and whether each is required.', parameters: null },
  {
    name: 'inspectSampleRecords',
    description: 'Returns the first N sample source records (max 10) and a per-field profile (missing counts, distinct example values) over ALL sample records.',
    parameters: { type: 'object', properties: { limit: { type: 'integer', description: 'Number of records to return (1-10, default 5).' } } },
  },
  { name: 'getSupportedTransformations', description: 'Returns the fixed whitelist of transformations the backend can apply.', parameters: null },
  {
    name: 'validateMapping',
    description: 'Checks a proposed list of mappings against the real schemas and the transformation whitelist. Returns problems and warnings. Does not store anything.',
    parameters: {
      type: 'object',
      properties: {
        mappings: {
          type: 'array',
          description: 'Proposed mappings',
          items: {
            type: 'object',
            properties: {
              sourceField: { type: 'string' },
              targetField: { type: 'string' },
              transformation: { type: 'string' },
              confidence: { type: 'string' },
              reason: { type: 'string' },
            },
          },
        },
      },
      required: ['mappings'],
    },
  },
];

const describeSchema = (schema) => Object.entries(normalizeSchema(schema)).map(([name, s]) => ({ name, type: s.type, required: s.required }));

function profileRecords(records, sourceSchema) {
  const fields = Object.keys(normalizeSchema(sourceSchema));
  return fields.map((field) => {
    const values = records.map((r) => r[field]);
    const present = values.filter((v) => !isMissing(v));
    const distinct = [...new Set(present.map((v) => JSON.stringify(v)))].slice(0, 4).map((s) => JSON.parse(s));
    return {
      field,
      missing: values.length - present.length,
      distinctExamples: distinct,
      jsTypesSeen: [...new Set(present.map((v) => typeof v))],
    };
  });
}

/** Builds a toolbox bound to one migration's immutable input. */
function createToolbox(migration) {
  const handlers = {
    inspectSourceSchema: () => ({ fields: describeSchema(migration.sourceSchema) }),
    inspectTargetSchema: () => ({ fields: describeSchema(migration.targetSchema) }),
    inspectSampleRecords: (args) => {
      const limit = Math.min(Math.max(parseInt(args && args.limit, 10) || 5, 1), 10);
      return {
        totalRecords: migration.sampleRecords.length,
        returned: Math.min(limit, migration.sampleRecords.length),
        records: migration.sampleRecords.slice(0, limit),
        fieldProfile: profileRecords(migration.sampleRecords, migration.sourceSchema),
      };
    },
    getSupportedTransformations: () => ({ transformations: SUPPORTED_TRANSFORMATIONS }),
    validateMapping: (args) => {
      const r = validatePlan({ mappings: (args && args.mappings) || [] }, migration.sourceSchema, migration.targetSchema);
      return { valid: r.valid, problems: r.problems, warnings: r.warnings };
    },
  };

  const STEP_LABELS = {
    inspectSourceSchema: 'Inspected source schema',
    inspectTargetSchema: 'Inspected target schema',
    inspectSampleRecords: 'Inspected sample records',
    getSupportedTransformations: 'Checked supported transformations',
    validateMapping: 'Validated proposed mappings',
  };

  function execute(name, args) {
    // Whitelist lookup via own-property check: model-supplied names can never reach anything else.
    if (!Object.prototype.hasOwnProperty.call(handlers, name)) {
      return { ok: false, refused: true, result: { error: `Unknown tool "${name}". Only these tools exist: ${Object.keys(handlers).join(', ')}.` } };
    }
    try {
      return { ok: true, result: handlers[name](args || {}) };
    } catch (e) {
      return { ok: false, result: { error: `Tool failed: ${e.message}` } };
    }
  }

  return { execute, definitions: TOOL_DEFINITIONS, stepLabel: (n) => STEP_LABELS[n] || n };
}

module.exports = { createToolbox, TOOL_DEFINITIONS };
