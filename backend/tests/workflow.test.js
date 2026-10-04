const request = require('supertest');
const db = require('./helpers/db');
const { createApp } = require('../src/app');
const { TargetRecord, QuarantineRecord, MigrationExecution, MigrationEvent, Migration } = require('../src/models');
const { buildDemoDatasets } = require('../src/seed/demoData');

const app = createApp();
const demo = buildDemoDatasets();
const payload = (d) => ({ name: d.name, sourceSchema: d.sourceSchema, targetSchema: d.targetSchema, sampleRecords: d.sampleRecords });

const create = async (d = demo.full) => (await request(app).post('/api/migrations').send(payload(d)).expect(201)).body;
const analyze = (id) => request(app).post(`/api/migrations/${id}/analyze`);
const approve = (id, body = { approvedBy: 'tester' }) => request(app).post(`/api/migrations/${id}/approve`).send(body);
const dryRun = (id) => request(app).post(`/api/migrations/${id}/dry-run`);
const execute = (id) => request(app).post(`/api/migrations/${id}/execute`);
const rollback = (id) => request(app).post(`/api/migrations/${id}/rollback`);
const detail = async (id) => (await request(app).get(`/api/migrations/${id}`).expect(200)).body;

/** Drives a migration to DRY_RUN_COMPLETED. */
async function readyToExecute(d = demo.full) {
  const m = await create(d);
  await analyze(m._id).expect(200);
  await approve(m._id).expect(200);
  await dryRun(m._id).expect(200);
  return m._id;
}

beforeAll(() => db.connect());
afterAll(() => db.disconnect());
beforeEach(() => db.reset());

describe('create + validation', () => {
  test('rejects invalid input with actionable messages', async () => {
    const res = await request(app).post('/api/migrations').send({ name: '', sourceSchema: '{bad', targetSchema: {}, sampleRecords: [] }).expect(400);
    expect(res.body.error.details.join(' ')).toMatch(/valid JSON source schema/);
  });
  test('enforces MAX_SAMPLE_RECORDS', async () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ customer_id: i }));
    const res = await request(app).post('/api/migrations').send({ ...payload(demo.mini), sampleRecords: many }).expect(400);
    expect(res.body.error.message).toMatch(/maximum of 100/);
  });
  test('malformed JSON body returns 400', async () => {
    await request(app).post('/api/migrations').set('content-type', 'application/json').send('{nope').expect(400);
  });
  test('unknown id returns 404, malformed id returns 404', async () => {
    await request(app).get('/api/migrations/000000000000000000000000').expect(404);
    await request(app).get('/api/migrations/not-an-id').expect(404);
  });
});

describe('AI analysis (mock provider through the real agent loop)', () => {
  test('produces a stored, validated, versioned plan with agent activity', async () => {
    const m = await create();
    const res = await analyze(m._id).expect(200);
    expect(res.body.status).toBe('PLAN_READY');
    const plan = res.body.plans[0];
    expect(plan.version).toBe(1);
    expect(plan.createdBy).toBe('ai');
    expect(plan.mappings.map((x) => `${x.sourceField}>${x.targetField}`)).toEqual(
      expect.arrayContaining(['customer_id>id', 'full_name>name', 'email>email', 'phone>contact_number', 'city>location'])
    );
    expect(plan.mappings.find((x) => x.sourceField === 'phone').transformation).toBe('normalize_phone');
    expect(plan.unmappedSourceFields).toEqual(['internal_notes']);
    expect(plan.unmappedTargetFields).toEqual(['segment']);
    expect(plan.clarificationQuestions.length).toBeGreaterThan(0);
    expect(plan.agentActivity.map((a) => a.tool)).toEqual(expect.arrayContaining(['inspectSourceSchema', 'inspectTargetSchema', 'inspectSampleRecords', 'getSupportedTransformations', 'validateMapping']));
  });

  test('analysis failure moves the migration to FAILED, stores no plan, and can be retried', async () => {
    const m = await create();
    process.env.AI_PROVIDER = 'openai';
    const prevKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const res = await analyze(m._id).expect(503);
    expect(res.body.error.code).toBe('AI_NOT_CONFIGURED');
    process.env.AI_PROVIDER = 'mock';
    if (prevKey) process.env.OPENAI_API_KEY = prevKey;
    const failed = await detail(m._id);
    expect(failed.status).toBe('FAILED');
    expect(failed.plans).toHaveLength(0);
    expect(failed.lastError).toMatch(/OPENAI_API_KEY/);
    await analyze(m._id).expect(200); // FAILED -> ANALYZING -> PLAN_READY
  });
});

describe('approval gate and state machine', () => {
  test('migration cannot dry-run or execute before approval', async () => {
    const m = await create();
    await analyze(m._id).expect(200);
    expect((await dryRun(m._id).expect(409)).body.error.code).toBe('PLAN_NOT_APPROVED');
    expect((await execute(m._id).expect(409)).body.error.code).toBe('PLAN_NOT_APPROVED');
    expect(await TargetRecord.countDocuments({})).toBe(0);
  });

  test('cannot execute an approved plan without a dry run', async () => {
    const m = await create();
    await analyze(m._id);
    await approve(m._id).expect(200);
    expect((await execute(m._id).expect(409)).body.error.code).toBe('DRY_RUN_REQUIRED');
  });

  test('cannot approve a draft, or approve twice', async () => {
    const m = await create();
    await approve(m._id).expect(409);
    await analyze(m._id);
    await approve(m._id).expect(200);
    await approve(m._id).expect(409);
  });

  test('reject then regenerate keeps the rejected version and requires fresh approval', async () => {
    const m = await create();
    await analyze(m._id);
    await request(app).post(`/api/migrations/${m._id}/reject`).send({ reason: 'phone looks wrong' }).expect(200);
    expect((await detail(m._id)).status).toBe('REJECTED');
    await analyze(m._id).expect(200);
    const d = await detail(m._id);
    expect(d.plans.map((p) => `${p.version}:${p.status}`)).toEqual(['1:REJECTED', '2:PROPOSED']);
    expect(d.approvedPlanVersion).toBeNull();
  });

  test('re-analysing after approval revokes the approval', async () => {
    const id = await readyToExecute();
    await analyze(id).expect(200);
    const d = await detail(id);
    expect(d.status).toBe('PLAN_READY');
    expect(d.approvedPlanVersion).toBeNull();
    expect(d.plans[0].status).toBe('SUPERSEDED');
    expect((await execute(id).expect(409)).body.error.code).toBe('PLAN_NOT_APPROVED');
  });

  test('reviewer edits are validated and stored as a new user-authored version', async () => {
    const m = await create();
    const planned = (await analyze(m._id)).body.plans[0];
    const bad = planned.mappings.map((x) => (x.sourceField === 'phone' ? { ...x, transformation: 'eval' } : x));
    expect((await approve(m._id, { mappings: bad }).expect(400)).body.error.code).toBe('PLAN_INVALID');

    const edited = planned.mappings.map((x) => (x.sourceField === 'city' ? { ...x, transformation: 'uppercase' } : x));
    await approve(m._id, { approvedBy: 'bob', mappings: edited }).expect(200);
    const d = await detail(m._id);
    expect(d.plans.map((p) => `${p.version}:${p.createdBy}:${p.status}`)).toEqual(['1:ai:SUPERSEDED', '2:user:APPROVED']);
    expect(d.approvedPlanVersion).toBe(2);
    expect(d.plans[1].basedOnVersion).toBe(1);
    const run = (await dryRun(m._id).expect(200)).body;
    expect(run.acceptedRecords[0].record.location).toBe('BHOPAL'); // city edited from trim to uppercase by the reviewer
  });
});

describe('dry run', () => {
  test('is deterministic, shows counts, and writes nothing to the target', async () => {
    const m = await create();
    await analyze(m._id);
    await approve(m._id);
    const a = (await dryRun(m._id).expect(200)).body;
    const b = (await dryRun(m._id).expect(200)).body;
    expect([a.sourceCount, a.transformedCount, a.acceptedCount, a.rejectedCount]).toEqual([100, 97, 92, 8]);
    expect(b.acceptedRecords).toEqual(a.acceptedRecords);
    expect(await TargetRecord.countDocuments({})).toBe(0);
    expect(await QuarantineRecord.countDocuments({})).toBe(0);
    const bad = a.rejectedRecords.find((r) => r.rowIndex === 16);
    expect(bad.fieldErrors.map((e) => `${e.field}:${e.rule}`).sort()).toEqual(['contact_number:MISSING_REQUIRED', 'email:EMAIL_FORMAT']);
  });
  test('mini example from the brief: invalid email is rejected', async () => {
    const m = await create(demo.mini);
    await analyze(m._id);
    await approve(m._id);
    const r = (await dryRun(m._id).expect(200)).body;
    expect([r.acceptedCount, r.rejectedCount]).toEqual([1, 1]);
    expect(r.rejectedRecords[0].fieldErrors[0]).toEqual({ field: 'email', message: 'Invalid email format', rule: 'EMAIL_FORMAT' });
  });
});

describe('execution, quarantine, idempotency, reconciliation, rollback', () => {
  test('successful migration inserts only accepted records and quarantines the rest with evidence', async () => {
    const id = await readyToExecute();
    const res = await execute(id).expect(200);
    expect(res.body).toMatchObject({ status: 'COMPLETED', isRetry: false, acceptedCount: 92, rejectedCount: 8, insertedCount: 92, duplicateCount: 0 });
    expect(res.body.insertedTargetIds).toHaveLength(92);
    expect(await TargetRecord.countDocuments({ migrationId: id })).toBe(92);
    const sample = await TargetRecord.findOne({ migrationId: id, sourceRecordId: '1' }).lean();
    expect(sample.data).toMatchObject({ id: 1, name: 'Amit Sharma', email: 'amit@gmail.com', contact_number: '919876543210', created_at: '2021-02-02', loyalty_points: 10 });

    const q = (await request(app).get(`/api/migrations/${id}/quarantine`).expect(200)).body;
    expect(q.total).toBe(8);
    expect(q.items.every((x) => x.executionId === res.body.executionId && String(x.migrationId) === id)).toBe(true);
    const rec7 = q.items.find((x) => x.rowIndex === 6);
    expect(rec7.sourceRecord.email).toBe('invalid-email'); // original preserved
    expect(rec7.fieldErrors[0].rule).toBe('EMAIL_FORMAT');
    expect(await TargetRecord.countDocuments({ migrationId: id, sourceRecordId: '7' })).toBe(0); // invalid never inserted
    expect((await detail(id)).status).toBe('COMPLETED');
  });

  test('retrying the same migration inserts nothing new (92 duplicates skipped)', async () => {
    const id = await readyToExecute();
    const first = (await execute(id).expect(200)).body;
    const second = (await execute(id).expect(200)).body;
    expect(first.insertedCount).toBe(92);
    expect(second).toMatchObject({ isRetry: true, insertedCount: 0, duplicateCount: 92, status: 'COMPLETED' });
    expect(await TargetRecord.countDocuments({ migrationId: id })).toBe(92);
    expect(await QuarantineRecord.countDocuments({ migrationId: id })).toBe(8); // not re-quarantined on retry
    const types = (await MigrationEvent.find({ migrationId: id }).sort({ createdAt: 1 }).lean()).map((e) => e.type);
    expect(types).toContain('migration_retried');
  });

  test('concurrent executes cannot create duplicates', async () => {
    const id = await readyToExecute();
    const [a, b] = await Promise.all([execute(id), execute(id)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await TargetRecord.countDocuments({ migrationId: id })).toBe(92);
  });

  test('the idempotency key has a unique index at the database level', async () => {
    const id = await readyToExecute();
    await execute(id);
    const existing = await TargetRecord.findOne({ migrationId: id }).lean();
    await expect(TargetRecord.create({ migrationId: id, executionId: 'x', planVersion: 1, idempotencyKey: existing.idempotencyKey, sourceRecordId: existing.sourceRecordId, data: {} })).rejects.toMatchObject({ code: 11000 });
  });

  test('reconciliation passes after execution and reports a mismatch if the target store is tampered with', async () => {
    const id = await readyToExecute();
    await execute(id);
    let r = (await detail(id)).reconciliation;
    expect(r).toMatchObject({ state: 'PASSED', passed: true, expected: 92, inserted: 92, difference: 0, quarantinedCount: 8 });
    await TargetRecord.deleteOne({ migrationId: id });
    r = (await detail(id)).reconciliation;
    expect(r).toMatchObject({ state: 'FAILED', passed: false, expected: 92, inserted: 91, difference: 1 });
  });

  test('a failed execution inserts nothing, is marked FAILED, and can be re-run', async () => {
    const id = await readyToExecute();
    const real = TargetRecord.create.bind(TargetRecord);
    let calls = 0;
    const spy = jest.spyOn(TargetRecord, 'create').mockImplementation((...args) => {
      calls += 1;
      if (calls === 10) return Promise.reject(new Error('simulated write failure'));
      return real(...args);
    });
    const res = await execute(id).expect(500);
    expect(res.body.error.message).toBe('Migration failed. No target records were inserted.');
    spy.mockRestore();
    expect(await TargetRecord.countDocuments({ migrationId: id })).toBe(0);
    expect(await QuarantineRecord.countDocuments({ migrationId: id })).toBe(0);
    const d = await detail(id);
    expect(d.status).toBe('FAILED');
    expect(d.executions.find((e) => e.type === 'EXECUTION').status).toBe('FAILED');
    const ok = (await execute(id).expect(200)).body;
    expect(ok.insertedCount).toBe(92);
    expect((await detail(id)).status).toBe('COMPLETED');
  });

  test('rollback removes only this migration\'s records, keeps quarantine + history, and cannot be repeated', async () => {
    const a = await readyToExecute();
    const b = await readyToExecute();
    await execute(a);
    await execute(b);
    await execute(a); // retry before rollback
    const res = (await rollback(a).expect(200)).body;
    expect(res.removed).toBe(92);
    expect(res.migration.status).toBe('ROLLED_BACK');
    expect(res.reconciliation).toMatchObject({ state: 'ROLLED_BACK', expected: 0, inserted: 0, difference: 0 });
    expect(await TargetRecord.countDocuments({ migrationId: a })).toBe(0);
    expect(await TargetRecord.countDocuments({ migrationId: b })).toBe(92); // untouched
    expect(await QuarantineRecord.countDocuments({ migrationId: a })).toBe(8); // evidence preserved
    const types = (await request(app).get(`/api/migrations/${a}/history`).expect(200)).body.events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['migration_created', 'migration_analyzed', 'migration_approved', 'dry_run_completed', 'migration_started', 'migration_retried', 'migration_completed', 'migration_rolled_back']));
    expect((await rollback(a).expect(409)).body.error.code).toBe('ALREADY_ROLLED_BACK');
    expect((await execute(a).expect(409)).body.error.code).toBe('INVALID_STATE');
    expect(await MigrationExecution.countDocuments({ migrationId: a, type: 'EXECUTION', status: 'ROLLED_BACK' })).toBe(2);
  });

  test('cannot roll back a migration that was never executed', async () => {
    const id = await readyToExecute();
    await rollback(id).expect(409);
  });
});

describe('dashboard listing', () => {
  test('returns stats and recent migrations', async () => {
    const a = await readyToExecute(demo.mini);
    await execute(a);
    await create(demo.mini);
    const res = (await request(app).get('/api/migrations').expect(200)).body;
    expect(res.stats).toMatchObject({ total: 2, draft: 1, successful: 1, pendingApproval: 0, rolledBack: 0 });
    expect(res.items[0].sampleRecords).toBeUndefined();
  });
});
