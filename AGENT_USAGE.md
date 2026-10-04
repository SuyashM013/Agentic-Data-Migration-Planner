# AGENT_USAGE.md

How AI is used in this project, what it is trusted with (very little), and how its output is verified. Two different kinds of AI use are covered: **AI at runtime** (the migration agent) and **AI used to build the code**.

---

## 1. AI tools used

| Where | Tool | Role |
|---|---|---|
| Runtime | **OpenAI API** (`AI_PROVIDER=openai`, default model `gpt-4o-mini`) or **Google Gemini API** (`AI_PROVIDER=gemini`, default `gemini-2.0-flash`) | Proposes the migration plan through read-only tools |
| Runtime (offline) | **Mock heuristic planner** (`AI_PROVIDER=mock`) | **Not an LLM.** Name-similarity rules behind the same provider interface, so the full agent loop runs without a key |
| Build time | **Claude (Anthropic)**, used in a chat session with a sandboxed shell | Wrote the code, tests and docs in this repository, phase by phase, running the tests as it went |
| Build time | FerretDB (MongoDB-compatible server) | Let the build session run integration tests where MongoDB binaries could not be downloaded |

**Important honesty note:** the OpenAI and Gemini adapters were verified with mocked HTTP (request shape, tool-call parsing, key redaction, error handling), not against the live APIs. Everything in section 6 labelled *simulated* comes from scripted test replies, not from a real model run. Section 6 also contains a table for you to record real observations from your own run.

---

## 2. Agent tools

The agent can call exactly these five tools (`backend/src/tools/index.js`). All are read-only.

| Tool | Purpose |
|---|---|
| `inspectSourceSchema` | Source field names, types, required flags |
| `inspectTargetSchema` | Target field names, types, required flags |
| `inspectSampleRecords` | First N (max 10) records + per-field profile over all records |
| `getSupportedTransformations` | The fixed whitelist and what each does |
| `validateMapping` | Runs the backend plan validator on proposed mappings; stores nothing |

Any other tool name the model emits is refused, logged in the plan's Agent activity (`Refused unknown tool`), and answered with an error message. There is no database, shell, SQL or code-execution tool.

---

## 3. Representative prompts

These are the actual prompts, taken from `backend/src/prompts/migrationAgentPrompt.js`.

### System prompt

```text
You are a migration planning assistant.

Your job is to propose how records in ONE source schema should be mapped into ONE target schema.

RULES
- You may inspect the provided schemas and sample records, and you may ONLY do so through the provided tools:
  inspectSourceSchema, inspectTargetSchema, inspectSampleRecords, getSupportedTransformations, validateMapping.
- Always call inspectSourceSchema, inspectTargetSchema, inspectSampleRecords and getSupportedTransformations before proposing mappings.
- Before giving your final answer, call validateMapping with your proposed mappings and fix any problems it reports.
- You may ONLY select transformations from this fixed list: none, trim, lowercase, uppercase, normalize_phone, string_to_number, number_to_string, date_format.
- Never invent fields. Every sourceField must exist in the source schema and every targetField must exist in the target schema.
- Never invent transformations. Never write code, SQL, JavaScript, shell commands or expressions.
- Never execute database operations. You cannot and must not modify any data.
- Each target field may be mapped from at most one source field.
- Pick a transformation only when the sample data or the type difference justifies it; otherwise use "none".
- Explain every proposed mapping in "reason" (one concise sentence).
- Identify uncertainty: use confidence "high" | "medium" | "low" honestly, and add a clarificationQuestion when you are unsure.
- Identify incompatible or missing fields: list source fields with no target, target fields with no source, and type problems in "risks".
- Look at the sample records for dirty data (bad emails, missing values, inconsistent formats, duplicates) and mention what you see in "risks".
- Do not approve your own plan. Human approval is mandatory before anything is executed.

FINAL ANSWER FORMAT
When you are done, reply with ONLY one JSON object (no markdown fences, no commentary) of exactly this shape:
{
  "mappings": [
    { "sourceField": "string", "targetField": "string", "transformation": "one of the supported transformations", "confidence": "high|medium|low", "reason": "string" }
  ],
  "unmappedSourceFields": ["source fields you did not map"],
  "unmappedTargetFields": ["target fields you could not fill"],
  "risks": [ { "severity": "low|medium|high", "message": "string" } ],
  "clarificationQuestions": ["questions a human should answer before approving"]
}
```

### User prompt (the only task message; **no data is embedded**, the model must use tools)

```text
Plan the migration named "Customer Migration (100 records)". The source dataset has 100 sample records. Use the tools to inspect everything, validate your mappings, then return the final JSON plan.
```

### Repair prompt (sent at most once, only if the backend rejects the plan)

```text
Your plan was rejected by the backend validator for these reasons:
- Mapping #4: transformation "normalize_phone_with_regex(..)" is not supported. Allowed: none, trim, ...
- Mapping #6: source field "loyalty_tier" does not exist in the source schema (fields must not be invented).

Fix every problem (do not invent fields or transformations), call validateMapping to confirm, then reply with ONLY the corrected JSON object.
```

---

## 4. Delegated work

**Delegated to the LLM at runtime (judgement tasks):**

- Deciding which source field corresponds to which target field.
- Choosing a transformation *from the whitelist* when a type or format difference justifies one.
- Rating its own confidence and writing a one-sentence reason per mapping.
- Spotting dirty data in the sample (bad emails, missing values, mixed formats) and describing risks.
- Writing clarification questions for a human.

**Never delegated (always deterministic code):**

- Whether a record is valid (`engine/validators.js`, `engine/transformRecord.js`).
- How a value is transformed (`engine/transformations.js`).
- Which fields are unmapped (recomputed by the backend, not taken from the model).
- Approval, dry run, execution, idempotency, quarantine, reconciliation, rollback, state transitions, history.
- Anything that touches the database.

**Delegated to Claude at build time:** writing and testing the application code in this repository. A human owner should still review it; the tests are the main safety net.

---

## 5. How the model is constrained (and why)

| Risk | Control |
|---|---|
| Model invents a field | `validatePlan` checks every source/target field against the real schemas |
| Model invents or smuggles a transformation (e.g. an expression) | Names are checked against the whitelist; the executor is a lookup table of fixed functions, never `eval` |
| Model picks a type-incompatible conversion | The validator computes the output type of each transformation and compares it to the target type |
| Model maps two sources to one target | Rejected as a duplicate target |
| Model lies about unmapped fields | Backend recomputes them |
| Model produces malformed or prose output | JSON extraction, then validation; one repair round, then the plan is discarded and the migration is `FAILED` |
| Model calls an unexpected tool | Own-property lookup in a fixed handler table; unknown names are refused |
| Model loops | 14 tool calls / 10 turns maximum |
| Model approves itself | There is no code path from the agent to `APPROVED`; only `POST /approve` does that |
| Key leakage | Key is read server-side only, sent in headers (never URLs), redacted from error messages and logs |

---

## 6. AI mistakes

### 6a. Mistakes by the runtime model

The failure modes below are the ones the system is designed to catch. They are **simulated with scripted replies in `backend/tests/ai.test.js`**, not captured from a live model.

| Case | Simulated behaviour | What the system does |
|---|---|---|
| Unsupported transformation | Plan uses `normalize_phone_with_regex("..")` | Validator rejects ("not supported"); repair prompt lists the allowed names; the corrected plan is accepted |
| Incorrect / invented mapping | Plan maps `loyalty_tier` → `tier`, neither of which exist | Rejected as invented fields |
| Incompatible mapping | `customer_id` (number) → `name` (string) with `none` | Rejected as incompatible types |
| Incomplete mapping | Only 2 of 5 fields mapped | Accepted (it is a legitimate plan) but the backend recomputes unmapped lists and adds a **high** risk for each unmapped *required* target field, so the reviewer sees it |
| Non-JSON answer | Prose instead of JSON | Treated as invalid; repair round; then discarded |
| Persistently wrong | Invalid twice | Plan discarded, migration `FAILED`, nothing stored |
| Uncertainty | Model returns `low` confidence or a clarification question | Shown to the reviewer; backend adds a medium risk for each low-confidence mapping |

**Record your real observations here** after running with a live provider. Please do not omit mistakes:

| Date | Provider / model | Dataset | What the model got wrong or was unsure about | Caught by | Outcome |
|---|---|---|---|---|---|
| | | | | | |

### 6b. Mistakes made by the AI that wrote this code (caught during the build)

These are real, found by running the code and the tests during development:

1. **Reserved Mongoose path.** The first schema used a field named `errors`; Mongoose warned it is reserved. Renamed to `fieldErrors` / `problems`.
2. **Wrong expectations in the AI's own tests** (the code was right, the expected numbers were not): transformed count guessed as 98 (correct: 97, three records fail at the transform stage); a date guessed as 2020 (correct: 2021); a city guessed as `INDORE` when the brief's record #1 deliberately overrides it to `Bhopal`. Each was recomputed by hand before changing the assertion.
3. **Misleading error on agent turn exhaustion.** If the model kept calling tools until the turn limit, the first version reported `AI_PLAN_INVALID` (a plan that was never produced). A test for runaway tool use exposed it; it now reports `AI_AGENT_ERROR`.
4. **Reference-captured test fixture.** A scripted-model helper stored a mutable array by reference, so an assertion looked at later messages. Fixed by snapshotting.
5. **Dependency on a database feature not available everywhere.** An update used `arrayFilters`, which the test database did not support; replaced with explicit index paths that work on MongoDB and compatible servers.
6. **Tooling slip.** A shell command (`pkill -f`) matched its own process and killed the session. No effect on the code.

---

## 7. Rejected suggestions

Design alternatives that were considered and rejected:

| Suggestion | Why it was rejected |
|---|---|
| Let the LLM decide whether a record is valid | Non-deterministic; the dry run must be reproducible and auditable |
| Let the model emit transformation code or expressions | Arbitrary code execution; whitelist plus fixed implementations is the whole safety story |
| Trust the model's `unmappedSourceFields` / `unmappedTargetFields` | Cheap to recompute exactly, and a wrong list would hide data loss from the reviewer |
| Let the agent auto-approve plans with all-"high" confidence | Violates mandatory human approval; confidence is self-reported |
| Put the schemas and records into the prompt | Gives the model unbounded data; tools cap what it sees (10 records + a profile) and make every access visible in Agent activity |
| Use provider SDKs | Extra dependencies for two HTTP calls; plain `fetch` keeps the surface small |
| Multi-document transactions for execute | Would require a replica set; atomic status claims, a unique idempotency index and compensation by `executionId` give the same safety on a standalone MongoDB |
| Rolling back by deleting everything for a migration name or a time window | Broad deletes are unsafe; rollback matches `migrationId` plus preserved inserted ids / execution ids only |
| Failing the whole plan if a *required* target field is unmapped | A reviewer may legitimately want to see the consequence; it is surfaced as a high risk instead (every record would be rejected) |

---

## 8. Verification

AI output is **never trusted directly**. Before anything can be executed:

1. **Parse**: the reply must be a JSON object.
2. **Backend validation** (`engine/planValidator.js`): real fields only, whitelisted transformations only, type-compatible, one source per target, a reason on every mapping, bounded sizes. Output is rebuilt from known keys, so extra properties the model adds are dropped.
3. **Backend-authored risks** are added regardless of what the model said.
4. **Human approval**: a person reviews mappings, risks and questions and may edit transformations (saved as a new version). Only `POST /approve` can approve.
5. **Deterministic dry run**: every record is processed by plain code; the reviewer sees every rejection and its rule.
6. **Execution guards**: approved plan + completed dry run + matching input hash; the backend recomputes the result itself rather than reading stored output.
7. **Reconciliation** after the fact compares accepted vs actually inserted, source = accepted + rejected, and quarantine = rejected.

These controls are covered by automated tests (`npm test`, 56 tests).
