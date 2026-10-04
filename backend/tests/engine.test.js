const { applyTransformation } = require('../src/engine/transformations');
const { transformRecord, processRecords } = require('../src/engine/transformRecord');
const { validatePlan } = require('../src/engine/planValidator');
const { validateMigrationInput } = require('../src/engine/inputValidation');
const { buildDemoDatasets } = require('../src/seed/demoData');

const demo = buildDemoDatasets();
const MINI = demo.mini;
const miniPlan = {
  mappings: [
    { sourceField: 'customer_id', targetField: 'id', transformation: 'none', confidence: 'high', reason: 'id' },
    { sourceField: 'full_name', targetField: 'name', transformation: 'trim', confidence: 'high', reason: 'name' },
    { sourceField: 'email', targetField: 'email', transformation: 'lowercase', confidence: 'high', reason: 'email' },
    { sourceField: 'phone', targetField: 'contact_number', transformation: 'normalize_phone', confidence: 'high', reason: 'phone' },
    { sourceField: 'city', targetField: 'location', transformation: 'trim', confidence: 'high', reason: 'city' },
  ],
};

describe('plan validation (valid schema mapping)', () => {
  test('accepts the example mapping from the brief', () => {
    const r = validatePlan(miniPlan, MINI.sourceSchema, MINI.targetSchema);
    expect(r.valid).toBe(true);
    expect(r.plan.mappings).toHaveLength(5);
    expect(r.plan.unmappedSourceFields).toEqual([]);
    expect(r.plan.unmappedTargetFields).toEqual([]);
  });

  test('rejects invented fields, unsupported transformations and type mismatches', () => {
    const bad = {
      mappings: [
        { sourceField: 'ghost', targetField: 'id', transformation: 'none', confidence: 'high', reason: 'x' },
        { sourceField: 'full_name', targetField: 'nope', transformation: 'none', confidence: 'high', reason: 'x' },
        { sourceField: 'email', targetField: 'email', transformation: 'run_sql("drop")', confidence: 'high', reason: 'x' },
        { sourceField: 'customer_id', targetField: 'name', transformation: 'none', confidence: 'high', reason: 'x' },
        { sourceField: 'phone', targetField: 'contact_number', transformation: 'none', confidence: 'high', reason: '' },
      ],
    };
    const r = validatePlan(bad, MINI.sourceSchema, MINI.targetSchema);
    expect(r.valid).toBe(false);
    const text = r.problems.join('\n');
    expect(text).toMatch(/source field "ghost"/);
    expect(text).toMatch(/target field "nope"/);
    expect(text).toMatch(/not supported/);
    expect(text).toMatch(/incompatible types/);
    expect(text).toMatch(/non-empty "reason"/);
  });

  test('rejects two sources mapped to one target and non-object plans', () => {
    const dup = {
      mappings: [
        { sourceField: 'full_name', targetField: 'name', transformation: 'none', confidence: 'high', reason: 'a' },
        { sourceField: 'city', targetField: 'name', transformation: 'none', confidence: 'high', reason: 'b' },
      ],
    };
    expect(validatePlan(dup, MINI.sourceSchema, MINI.targetSchema).problems.join()).toMatch(/already mapped/);
    expect(validatePlan('nonsense', MINI.sourceSchema, MINI.targetSchema).valid).toBe(false);
  });

  test('recomputes unmapped fields itself and flags required unmapped target as a high risk', () => {
    const partial = { mappings: miniPlan.mappings.slice(0, 2), unmappedSourceFields: ['LIES'] };
    const r = validatePlan(partial, MINI.sourceSchema, MINI.targetSchema);
    expect(r.valid).toBe(true);
    expect(r.plan.unmappedSourceFields).toEqual(['email', 'phone', 'city']);
    expect(r.plan.risks.some((x) => x.severity === 'high' && x.source === 'backend')).toBe(true);
  });
});

describe('input validation (invalid schema input)', () => {
  const ok = { name: 'x', sourceSchema: { a: 'string' }, targetSchema: { b: 'string' }, sampleRecords: [{ a: 'v' }] };
  test('accepts valid input', () => expect(validateMigrationInput(ok, 100).name).toBe('x'));
  test('reports malformed JSON, missing name, bad types and empty samples', () => {
    let err;
    try {
      validateMigrationInput({ name: ' ', sourceSchema: '{oops', targetSchema: { b: 'blob' }, sampleRecords: [] }, 100);
    } catch (e) { err = e; }
    expect(err.status).toBe(400);
    const text = err.details.join('\n');
    expect(text).toMatch(/name is required/);
    expect(text).toMatch(/valid JSON source schema/);
    expect(text).toMatch(/unsupported type "blob"/);
    expect(text).toMatch(/non-empty JSON array/);
  });
  test('enforces the bounded dataset size', () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ a: String(i) }));
    expect(() => validateMigrationInput({ ...ok, sampleRecords: many }, 100)).toThrow(/maximum of 100/);
  });
  test('rejects dangerous field names', () => {
    expect(() => validateMigrationInput({ ...ok, sourceSchema: { __proto__x: 'string', 'a.b': 'string' } }, 100)).toThrow();
    expect(() => validateMigrationInput({ ...ok, sourceSchema: JSON.parse('{"__proto__":"string"}') }, 100)).toThrow();
  });
});

describe('deterministic transformations', () => {
  test('normalize_phone', () => {
    expect(applyTransformation('normalize_phone', '+91 98765-43210')).toBe('919876543210');
    expect(applyTransformation('normalize_phone', '(888) 888-8888')).toBe('8888888888');
    expect(() => applyTransformation('normalize_phone', '12-34')).toThrow(/7-15 digits/);
  });
  test('string/number conversions', () => {
    expect(applyTransformation('string_to_number', ' 42 ')).toBe(42);
    expect(applyTransformation('string_to_number', '3.5')).toBe(3.5);
    expect(() => applyTransformation('string_to_number', 'N/A')).toThrow();
    expect(() => applyTransformation('string_to_number', '')).toThrow();
    expect(applyTransformation('number_to_string', 7)).toBe('7');
    expect(() => applyTransformation('number_to_string', '7')).toThrow();
  });
  test('trim / case', () => {
    expect(applyTransformation('trim', '  a ')).toBe('a');
    expect(applyTransformation('lowercase', 'AbC')).toBe('abc');
    expect(applyTransformation('uppercase', 'AbC')).toBe('ABC');
  });
  test('date_format', () => {
    expect(applyTransformation('date_format', '05/03/2024')).toBe('2024-03-05');
    expect(applyTransformation('date_format', '05-03-2024')).toBe('2024-03-05');
    expect(applyTransformation('date_format', '2024/03/05')).toBe('2024-03-05');
    expect(applyTransformation('date_format', '2024-03-05T10:00:00Z')).toBe('2024-03-05');
    expect(() => applyTransformation('date_format', '31/02/2024')).toThrow(/valid calendar date/);
  });
  test('unknown transformation names never execute', () => {
    expect(() => applyTransformation('eval', 'x')).toThrow(/Unsupported/);
    expect(() => applyTransformation('constructor', 'x')).toThrow(/Unsupported/);
  });
});

describe('record validation (invalid email rejection)', () => {
  test('valid record is transformed', () => {
    const r = transformRecord(MINI.sampleRecords[0], miniPlan, MINI.targetSchema);
    expect(r.errors).toEqual([]);
    expect(r.transformed).toEqual({ id: 1, name: 'Amit Sharma', email: 'amit@gmail.com', contact_number: '919876543210', location: 'Bhopal' });
  });
  test('invalid email is rejected with field, message and rule', () => {
    const r = transformRecord(MINI.sampleRecords[1], miniPlan, MINI.targetSchema);
    expect(r.transformed).toBeNull();
    expect(r.errors).toEqual([{ field: 'email', message: 'Invalid email format', rule: 'EMAIL_FORMAT' }]);
  });
  test('all errors on a record are preserved', () => {
    const rec = { customer_id: 17, full_name: 'P', email: 'bad', phone: '', city: 'X' };
    const r = transformRecord(rec, miniPlan, MINI.targetSchema);
    expect(r.errors.map((e) => `${e.field}:${e.rule}`).sort()).toEqual(['contact_number:MISSING_REQUIRED', 'email:EMAIL_FORMAT']);
  });
});

describe('processRecords on the demo dataset', () => {
  const full = demo.full;
  const fullPlan = {
    mappings: [
      ['customer_id', 'id', 'none'], ['full_name', 'name', 'trim'], ['email', 'email', 'lowercase'], ['phone', 'contact_number', 'normalize_phone'],
      ['city', 'location', 'trim'], ['signup_date', 'created_at', 'date_format'], ['loyalty_points', 'loyalty_points', 'string_to_number'],
    ].map(([sourceField, targetField, transformation]) => ({ sourceField, targetField, transformation, confidence: 'high', reason: 'r' })),
  };
  test('plan is valid, 100 in -> 92 accepted / 8 rejected, deterministic', () => {
    expect(validatePlan(fullPlan, full.sourceSchema, full.targetSchema).valid).toBe(true);
    const a = processRecords(full.sampleRecords, fullPlan, full.targetSchema);
    const b = processRecords(full.sampleRecords, fullPlan, full.targetSchema);
    expect(a.sourceCount).toBe(100);
    expect(a.accepted).toHaveLength(92);
    expect(a.rejected).toHaveLength(8);
    expect(a.transformedCount).toBe(97); // 3 records fail at the transform stage: #41 bad date, #64 non-numeric points, #90 short phone
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.rejected.map((r) => r.rowIndex + 1)).toEqual([7, 17, 33, 41, 58, 64, 77, 90]);
    const rec17 = a.rejected.find((r) => r.rowIndex === 16);
    expect(rec17.fieldErrors.map((e) => e.rule).sort()).toEqual(['EMAIL_FORMAT', 'MISSING_REQUIRED']);
    expect(a.rejected.find((r) => r.rowIndex === 76).fieldErrors[0].rule).toBe('DUPLICATE_SOURCE_ID');
    expect(rec17.sourceRecord.email).toBe('priya@@example'); // original preserved untouched
  });
});
