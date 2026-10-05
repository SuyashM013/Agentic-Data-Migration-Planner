# Agentic Data Migration Planner & Reconciliation Workbench

An AI agent **plans** a migration from a source schema to a target schema. A person **approves** the plan. A deterministic backend **dry-runs and executes** it, quarantines bad records with field-level evidence, refuses to insert duplicates on retry, reconciles totals, and can roll the whole thing back.

```
AI analysis → structured plan → backend validation → human approval → deterministic dry run → human confirmation → deterministic execution
```

The LLM never executes anything. It has five read-only tools, can only choose from eight whitelisted transformations, and its output is validated by the backend before it is stored.

---

## Live Demo

- **Frontend:** https://agentic-data-migration-planner.vercel.app/
- **Backend API:** https://agentic-data-migration-planner-y6u8.onrender.com
- **API Health Check:** https://agentic-data-migration-planner-y6u8.onrender.com/api/health

### [ NOTEE ]

 Before opening the live project, hit the backend health because my render loves to sleep, you have to wake him up before opening the application

--- 
## 1. Problem statement

A company has records in an old schema and must move a bounded dataset into a new schema. Hand-writing the mapping is slow; letting an LLM write and run migration code is unsafe. This project shows a middle path: the model does the tedious reasoning (which field maps where, which conversion fits, what looks risky), and everything that changes data is plain, tested, deterministic code behind a human approval gate.

---

## 2. Features

- Create a migration from JSON schemas + sample records (paste or upload), with validation and a hard `MAX_SAMPLE_RECORDS` cap.
- **AI agent** (OpenAI or Gemini, or an offline mock planner) that inspects schemas and samples through tools and returns a structured plan: mappings, confidence, reasons, unmapped fields, risks, clarification questions.
- **Backend plan validation**: no invented fields, no unsupported transformations, type compatibility, one source per target. Invalid AI output gets one repair round, then is discarded.
- **Versioned plans**: every AI plan, reviewer edit and regeneration is a new version; nothing is overwritten.
- **Explicit human approval** (and reject / regenerate). Reviewers can change transformations before approving; that is saved as a new `user` version.
- **Deterministic dry run**: source / transformed / accepted / rejected counts, accepted preview, and every rejected record with every failing field, message and rule.
- **Execution** into a mock target store with a confirmation step, quarantine of rejected records, and an idempotency key with a **unique database index**.
- **Retry-safe**: running again inserts 0 records and reports N duplicates skipped.
- **Reconciliation** computed live from the collections (four checks).
- **Rollback** deleting only records this migration created; quarantine and history are preserved.
- **Append-only history** and structured JSON logs with secret redaction.
- Dashboard, plan review, dry run, execution, reconciliation, quarantine and history screens.

---

## 3. Architecture

```
React (Vite + Tailwind)  ──REST──▶  Express API
                                      │
        ┌─────────────────────────────┼───────────────────────────────┐
        │ controllers (thin) → services (business logic)               │
        │                                                              │
        │  AI side (plans only)         Deterministic side (acts)      │
        │  ─ agentService               ─ engine/transformations       │
        │  ─ tools/ (read-only)         ─ engine/transformRecord       │
        │  ─ ai/providers               ─ engine/planValidator         │
        │  ─ prompts/                   ─ dryRun / execution / rollback│
        │                               ─ reconciliation               │
        └───────────────┬──────────────────────────────────────────────┘
                        ▼
                    MongoDB (Mongoose)
```

Folder layout:

```
backend/src/
  routes/ controllers/ services/   REST layer and business logic
  engine/                          transformations, validators, plan validator, record pipeline (pure functions)
  tools/                           the agent's five read-only tools
  ai/                              provider adapters (openai, gemini, mock) + JSON extraction
  prompts/                         the agent's system prompt (reviewable)
  models/                          Mongoose models
  seed/                            demo datasets + seed script
backend/tests/                     engine, agent/provider and full-workflow tests
frontend/src/{app,components,lib}  pages, UI, API client
```

The engine and the AI code share no logic. The only bridge is `planValidator`, which the AI's output must pass.

---

## 4. AI agent architecture

`services/agentService.js` runs a tool-calling loop against whichever provider is configured:

1. Send the system prompt (`prompts/migrationAgentPrompt.js`) and a short task message. **No data is in the prompt**; the model must fetch it through tools.
2. The model calls tools; the backend executes them and returns results. Unknown tool names are refused and logged (`Refused unknown tool "runSql"`). Max 14 tool calls and 10 turns.
3. The final reply is parsed as JSON and passed to `validatePlan`. If it fails, the problems are sent back **once** for repair. If it still fails, the plan is discarded, the migration moves to `FAILED`, and nothing is stored.
4. The backend recomputes `unmappedSourceFields` / `unmappedTargetFields` itself and adds its own deterministic risks (e.g. a required target field with no mapping). It does not trust the model's lists.

Providers (`AI_PROVIDER`): `openai`, `gemini` (both via plain `fetch`, no SDK), and `mock`, an **offline heuristic planner that is not an LLM**. It runs through the same tool loop so the whole app is demonstrable without an API key. Plans from it are labelled `ai:mock:heuristic`.

---

## 5. Tool descriptions

| Tool | What it returns |
|---|---|
| `inspectSourceSchema()` | Source fields, types, required flags |
| `inspectTargetSchema()` | Target fields, types, required flags |
| `inspectSampleRecords({limit})` | Up to 10 sample records plus a per-field profile (missing counts, distinct examples) over all records |
| `getSupportedTransformations()` | The whitelist with descriptions |
| `validateMapping({mappings})` | The backend plan validator's problems/warnings; stores nothing |

All five are read-only. There is no tool that writes, queries the database, or runs code.

**Supported transformations:** `none`, `trim`, `lowercase`, `uppercase`, `normalize_phone` (digits only, 7-15 digits), `string_to_number`, `number_to_string`, `date_format` (DD/MM/YYYY, DD-MM-YYYY, YYYY/MM/DD or ISO → `YYYY-MM-DD`). Implemented in `engine/transformations.js`; a startup check fails if the whitelist and implementations ever drift apart.

---

## 6. Migration lifecycle

```
DRAFT → ANALYZING → PLAN_READY → APPROVED → DRY_RUN_COMPLETED → EXECUTING → COMPLETED → ROLLED_BACK
                │         │  └→ REJECTED ─┐                          │            │
                └→ FAILED ┴───────────────┴→ ANALYZING (regenerate)  └→ FAILED    └→ EXECUTING (idempotent retry)
```

Transitions are enforced by `services/stateMachine.js` using an atomic compare-and-set (`findOneAndUpdate` filtered on current status), so two concurrent requests cannot both win. Notable rules:

- Dry run requires `APPROVED` / `DRY_RUN_COMPLETED`.
- Execute requires an approved plan **and** a completed dry run of that plan whose input hash still matches the data and mappings.
- Re-analysing after approval revokes the approval.
- A failed *retry* returns the migration to `COMPLETED` (earlier data is intact). A failed first execution becomes `FAILED` and can be re-run.
- `ROLLED_BACK` is terminal for execution. Its only self-transition re-runs rollback cleanup if an earlier rollback was interrupted.

---

## 7. Database design

| Collection | Purpose |
|---|---|
| `migrations` | Name, schemas, sample records, **embedded plan versions**, current/approved version, status, approval metadata |
| `migrationexecutions` | One document per dry run (`DRY_RUN`) or execution attempt (`EXECUTION`): counts, inserted target ids, `isRetry`, status, reconciliation snapshot |
| `quarantinerecords` | Original source record + field-level errors, `migrationId`, `executionId`, row index. Unique on (migration, execution, row) |
| `migrationevents` | Append-only audit trail (no update/delete code path) |
| `targetrecords` | The **mock target store**. Unique index on `idempotencyKey = migrationId:sourceRecordId` |

Counts: **transformed** = records whose transformation stage ran without error; **accepted** = records that also passed all validation; **rejected** = the rest. Quarantine rows are written by the first successful execution (retries would only duplicate them); before execution, rejected records are visible in the dry run.

---

## 8. API documentation

Base path `/api`. Errors are `{ "error": { "code", "message", "details" } }`.

| Method | Path | Description |
|---|---|---|
| POST | `/migrations` | Create. Body: `name`, `sourceSchema`, `targetSchema`, `sampleRecords` |
| GET | `/migrations` | List + dashboard stats |
| GET | `/migrations/:id` | Detail: plans, executions (incl. dry runs), live reconciliation |
| POST | `/migrations/:id/analyze` | Run the AI agent; stores a new plan version |
| POST | `/migrations/:id/approve` | Human approval. Optional `approvedBy`, optional edited `mappings` (saved as a new user version) |
| POST | `/migrations/:id/reject` | Reject current plan. Optional `reason` |
| POST | `/migrations/:id/dry-run` | Deterministic dry run |
| POST | `/migrations/:id/execute` | Execute (or idempotently retry) |
| POST | `/migrations/:id/rollback` | Remove only this migration's target records |
| GET | `/migrations/:id/quarantine` | Quarantined records |
| GET | `/migrations/:id/history` | Events + plan version summaries |
| GET | `/migrations/:id/target-records` | Preview of the mock target store (extra, for the UI) |
| GET | `/config`, `/demo-data`, `/health` | Limits and transformations, demo datasets, liveness (extra) |

Common error codes: `VALIDATION_ERROR` 400, `PLAN_INVALID` 400, `PLAN_NOT_APPROVED` 409, `DRY_RUN_REQUIRED` 409, `DRY_RUN_STALE` 409, `INVALID_STATE` 409, `ALREADY_ROLLED_BACK` 409, `AI_NOT_CONFIGURED` 503, `AI_PROVIDER_ERROR` 502, `AI_PLAN_INVALID` 422.

---

## 9. Local setup

Requirements: Node 18+ (20 recommended), a MongoDB (local, Docker, or Atlas).

```bash
git clone https://github.com/SuyashM013/Agentic-Data-Migration-Planner 
cp .env.example backend/.env        # then edit backend/.env
cp .env.example frontend/.env       # keep only VITE_API_URL if you like
cd backend && npm install && cd frontend && npm install
```

No MongoDB handy? `docker run -d -p 27017:27017 mongo:7` and leave `MONGODB_URI` as `mongodb://127.0.0.1:27017/migration_workbench`.

---

## 10. Environment variables

| Variable | Where | Meaning |
|---|---|---|
| `PORT` | backend | API port (default 5000) |
| `MONGODB_URI` | backend | Mongo connection string |
| `CORS_ORIGIN` | backend | Allowed frontend origin(s), comma-separated (`*` allows all) |
| `MAX_SAMPLE_RECORDS` | backend | Hard cap on dataset size (default 100) |
| `AI_PROVIDER` | backend |  `gemini` or `mock` |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | backend | Used when `AI_PROVIDER=openai` (default model `gpt-4o-mini`) |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | backend | Used when `AI_PROVIDER=gemini` (default `gemini-2.5-flash`) |
| `AI_TIMEOUT_MS` | backend | Per-request timeout to the AI provider |
| `VITE_API_URL` | frontend | Public URL of the API |

Keys live only in the backend environment and never reach the browser. `.env` is git-ignored; `.env.example` contains names only.

---

## 11-13. Running

```bash
# backend (terminal 1)
cd backend && npm run dev         
npm run seed                      # optional: creates the two demo migrations as drafts

# frontend (terminal 2)
cd frontend && npm run dev        # http://localhost:5173
```

Set `AI_PROVIDER=mock` to try everything without an API key.

--

## 14. Running tests

```bash
cd backend && npm test
```
- OpenAI/Gemini provider integrations were verified through live application testing.
- Provider-specific HTTP behavior is also covered by mocked automated tests.
- The mock provider remains available for deterministic testing without an API key.

Uses `mongodb-memory-server` (downloads a MongoDB binary on first run). To use your own server instead: `MONGODB_TEST_URI=mongodb://127.0.0.1:27017 npm test` (a throwaway database is created and dropped).

56 tests across three files:

- `engine.test.js`: plan validation (valid / invented field / unsupported transformation / type mismatch), input validation and size cap, every transformation, invalid-email rejection, all-errors-preserved, the 100 → 97 → 92 → 8 demo dataset, determinism.
- `ai.test.js`: the agent loop with scripted model replies (repair after a bad plan, discard after two, unknown-tool refusal, runaway-tool stop), tool behaviour, OpenAI/Gemini request shaping and key redaction with mocked HTTP, logger redaction.
- `workflow.test.js` (HTTP, real database): analysis, approval gate, no dry run/execute before approval, reviewer edit versioning, reject/regenerate, successful migration with quarantine evidence, duplicate retry (92 skipped), concurrent execute, unique-index enforcement, reconciliation pass and fail, mid-run failure compensation, scoped rollback (another migration untouched), history preserved.
---
## 15. Deployment

The application is deployed with the following architecture:

```text
Vercel
  │
  │ HTTPS / REST API
  ▼
Render
  │
  ▼
MongoDB Atlas
```
---

## 16. Completed Scope

The following assignment requirements are implemented and verified:

- Source and target schema input
- Bounded dataset enforcement
- AI-assisted schema analysis
- Read-only AI inspection tools
- Structured migration plan generation
- Backend validation of AI-generated plans
- Human approval before migration
- Migration plan versioning
- Deterministic dry run
- Field-level validation
- Quarantine of invalid records
- Source/transformed/accepted/rejected counts
- Mock target database
- Idempotent migration execution
- Duplicate prevention on retry
- Source/target reconciliation
- Migration rollback
- Append-only migration history
- Structured application and AI workflow logs
- Automated tests
- Demo/seed data
- Frontend and backend deployment

---

## 17. Excluded Scope

The following are intentionally outside the assignment scope:

- Production database connectors
- Arbitrary source/target databases
- Arbitrary or AI-generated executable transformation code
- Distributed migration
- Streaming migration
- Cloud database connectors
- Multiple simultaneous sources
- Multiple simultaneous targets
- Authentication and role-based access control
- Production-scale migration
- Real marketplace or external system integration

---

## 18. Known limitations

- **No authentication.** `approvedBy` is a free-text name, so the audit trail records who *claims* to have approved. Do not expose the API publicly with real data.
- **Sample data goes to the LLM provider.** Tools return up to 10 records plus example values per field. Do not use real personal data with a hosted provider unless that is acceptable to you.
- **AI provider testing:** OpenAI/Gemini provider integrations were verified through live application testing. Provider-specific HTTP behavior is also covered by mocked automated tests. The `mock` provider remains available for deterministic testing without an API key.
- **Stuck `ANALYZING`:** if the server dies mid-analysis the migration stays `ANALYZING`. There is no recovery timer.
- **No multi-document transactions** (so it also runs on a standalone MongoDB). Safety comes from atomic status claims, unique-index idempotency, and compensation by `executionId`.
- **Idempotency key is the source id** (the field mapped to target `id`, otherwise the row position). Two source rows with the same id are treated as a duplicate: the first valid one wins, later ones are quarantined as `DUPLICATE_SOURCE_ID`.
- **Rules are heuristic in places:** a target field is checked as an email when its name is or ends with `email`; schema fields are required unless declared `{ "type": ..., "required": false }`; `date_format` reads `NN/NN/YYYY` as day-first.
- A rolled-back migration cannot be executed again; create a new one.
- The mock target store is a single generic collection, not a typed table.
- No rate limiting or pagination (the dataset is capped at 100 records).
- The UI was build-checked and render-smoke-tested against real API data in every lifecycle state, but not exercised in a real browser as part of this build; expect to polish layout details.
---
## 19. Example migration

Source `{customer_id:number, full_name, email, phone, city}` → target `{id:number, name, email, contact_number, location}` with the brief's two records. The agent maps `customer_id→id`, `full_name→name`, `email→email`, `phone→contact_number` (`normalize_phone`), `city→location`. Dry run: record 1 accepted (`phone` becomes `919876543210`); record 2 rejected: `email: Invalid email format (EMAIL_FORMAT)`.

---

## 20. Reviewer / demo instructions

1. Start backend and frontend (use `AI_PROVIDER=mock` if you have no key).
2. **New migration → Load demo: 100 records → Analyze with AI.** The demo data has 8 deliberately bad records (3 invalid emails, an empty phone, an impossible date, a missing name, non-numeric loyalty points, a duplicate id, a too-short phone), one unmapped source field (`internal_notes`), one unmapped optional target field (`segment`), and a string→number type difference (`loyalty_points`).
3. On **AI plan**, read mappings, risks and questions. Try changing a transformation, then **Approve plan** (this creates plan v2 by "user"). Check **History → Plan versions**.
4. Confirm that before approval, `POST /api/migrations/:id/dry-run` and `/execute` return 409.
5. **Dry run:** expect Source 100, Transformed 97, Accepted 92, Rejected 8. Open the rejected list: record #17 shows two errors.
6. **Execute migration** (confirm dialog says 92). Then **Retry execution**: 0 inserted, 92 duplicates skipped.
7. **Reconciliation:** Expected 92, Inserted 92, Difference 0, passed. **Quarantine:** 8 rows with the original records.
8. **Roll back migration:** 92 removed; the target store is empty, quarantine and history remain, execution is blocked.
9. Seed from the CLI instead: `npm run seed` in `backend`.

---
## 🙋‍♂️ Author

Made with 💻 by Suyash Mishra

Feel free to reach out or connect on [LinkedIn](www.linkedin.com/in/mishrasuyash013)
