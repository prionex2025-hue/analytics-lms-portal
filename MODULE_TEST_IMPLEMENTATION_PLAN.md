# MODULE_TEST — Implementation Plan (for review)

> Status: **IMPLEMENTED and VERIFIED.** Backend **64 suites / 225 tests**, plus the
> module-report extensions below (counts listed in §0.1 bullet 5–6),
> **Frontend 14 suites / 43 tests**; lint 0 errors (only pre-existing warnings).
> Backend tests that hit MongoDB require a local `mongod` on `127.0.0.1:27017` —
> run the bundled memory-server binary, e.g.
> `Backend/node_modules/.cache/mongodb-memory-server/mongod-x64-ubuntu-8.2.6
> --dbpath /tmp/opencode/mongo-data --port 27017 --bind_ip 127.0.0.1 --fork
> --logpath /tmp/opencode/mongod.log`.
> Scope: add a `MODULE_TEST` assessment format (Quant → Reasoning → Verbal, per-module server-authoritative timers) while keeping the current `OPEN_TEST` behaviour byte-for-byte compatible.

---

## 0. Critical naming decision (read first)

The word **`testType` is already used** by the codebase with a *completely different meaning* — proctoring strictness:

- `src/services/test-config.service.js` → `TEST_TYPES = { STRICT, STANDARD, OPEN }`
- `test.schema.js` / `db.js` defaults store `testType: "STANDARD"` and drive `proctoringPreset` (`STRICT_EXAM`/`STANDARD_TEST`/`OPEN_TEST`).
- The Zod schema `admin-tests.schema.js` validates `testType: z.enum([STRICT, STANDARD, OPEN])`.
- The student payload exposes `test_type` (proctoring) which the frontend consumes.

**The spec's "OPEN_TEST vs MODULE_TEST" is a different axis (assessment *format*), not proctoring.** Overloading `testType` would break the proctoring pipeline and the existing `OPEN_TEST` proctoring preset (name collision).

**Decision:** introduce a new field **`assessmentFormat`** on the test:
- Values: `"OPEN_TEST"` (default) | `"MODULE_TEST"`.
- Absent/legacy ⇒ treated as `"OPEN_TEST"`.
- The existing `testType`/`proctoringPreset`/`test_type` machinery is left untouched and continues to apply to MODULE_TEST the same way it does today.

This keeps the spec's vocabulary in the API/UI (`OPEN_TEST`/`MODULE_TEST`) without colliding with the proctoring `testType`. Every reference to "test type selection" in the spec maps to `assessmentFormat`.

---

## 0.1 Shipped scope (verified, Sept 2026) — read this first

Implemented end-to-end per this plan, with the file references below as the source of truth. The numbered sections 1–22 below remain the design rationale; where reality diverged the notes here win.

- **Config/schema/validator foundation:** `test-config.service.js` — `ASSESSMENT_FORMATS`, `MODULE_DEFINITIONS`, `ALLOWED_MODULE_CATEGORIES`, `normalizeAssessmentFormat`, `normalizeModuleCategory`, `resolveModules` (injects `category`/`key` from canonical defs, never client-trusted), `validateModuleAssessment`, `attachResolvedTestConfiguration` (surfaces `assessment_format`/`assessmentFormat`/`modules`). `db.js` defaults already include `test.assessmentFormat:"OPEN_TEST"`, `test.modules:[]`, `question.category:null`, `questionBank.category:null` — no further default change needed.
- **Admin create/update/clone + import:** `Admin/tests.controller.js` — `assessmentFormat`/`modules` persisted, `durationMins = Σ module durations`, module category validation on create/update/import (`422 MODULE_DURATION_INVALID | MODULE_CATEGORY_MISSING | MODULE_CATEGORY_INVALID | MODULE_EMPTY`). Question-bank category support in Admin + SuperAdmin question-bank controllers (create/import/update/export/filter).
- **Student runtime:** module-aware start/session/summary; `moduleState[].{key,name,order,category,configuredDurationMins,startedAt,endedAt,timeTakenSeconds,status,score,maxScore,percentage}` + `currentModuleKey` + `moduleExpiresAt`; `saveAttemptAnswersCompat` guard → `MODULE_TIME_EXPIRED` / `QUESTION_NOT_IN_ACTIVE_MODULE` (importer contract per §15/§16); `extendAttemptTime` extends the **active module's** `moduleExpiresAt`, capped at whole-test `testSession.expiresAt`, and mirrors to Redis + audit + socket.
- **Reports/analytics:** `report-formatter.service.js` renders Section Performance from `submission.moduleState`; `Students/reports.controller.js` `by_test` emits `sections[]`/`overall_*`. Admin `reports.controller.js` `buildReportAnalyticsPayload` returns **`modulePerformance`** (via `aggregateModulePerformance`) for a single MODULE_TEST scope; Admin + SuperAdmin `getReportTableDashboard` rows carry **`moduleScores`** (via `buildSubmissionModuleColumns`). SuperAdmin analytics `aggregateReportSubmissions` facet `byModule` → `modulePerformance.moduleStats`. **Frontend:** deep-dive Student Results table gains a per-module column per section (Quant/Reasoning/Verbal) + a "Module Performance" summary card row; Admin/SuperAdmin test-list pages show a **"Module Test · N sections"** badge.
- **Known deviations from the original plan text:**
  1. The SuperAdmin no-college-id department fallback was made module-aware; per-student module rows use the `name` key (Admin pipeline key, `row.name || row.studentName || row.userId`), not `studentName`/`studentId`.
  2. The compound question index `{testId, category, order}` was **not** added — module question scoping currently filters the already-loaded test-question set in memory (see `Students/tests.controller.js` `normalizeQuestionCategory` guard); revisit if a dedicated `{testId, category}` query appears.
  3. Frontend question-bank pages (`Admin/QuestionBankPage.jsx`, `SuperAdmin/QuestionBankPage.jsx` + their slices) gained the missing `category` field UI/filter/query-param — a real functional gap found during the bug-fixing pass.
  4. `testSession` is schemaless; module timing stored on submission `moduleState` + mirrored live to Redis `exam_state` (Redis fail-open → Mongo authoritative).
  5. **Student runtime verified complete** (the plan's deferrable §19-18 verification): `module-attempt.service.js` (init/advance/auto-advance/view + idempotency + no-carry-over + hard-cap clamp), module-aware start/session/answer/submit + `POST /:testId/module/advance` (`advanceModuleAttempt`, Redis-locked), `QUESTION_NOT_IN_ACTIVE_MODULE`/`MODULE_TIME_EXPIRED` guards, `finalizeModuleState` per-module scoring, exam-state module fields, `TestEnvironmentPage` display-only stepper + per-module timer (`server_module_end_time`) + expiry→advance, slice advance reducers, and `ResumeAttemptPage`→session auto-advance. Covered by `module-flow.integration.test.js`, `module-flow-superadmin.integration.test.js`, `module-attempt.service.test.js`, `module-test-scoring.test.js`, `module-report-analytics.test.js`, `student-tests-compat.routes.test.js`, `student-tests-routes.rate-limit.test.js`, `Frontend/src/features/Students/testSlice.moduleTest.test.js`.
   6. **Test-type-dynamic PDF report (follow-up, Sept 2026):** the existing queued Puppeteer PDF pipeline now carries module content **explicitly by test type** (`assessmentFormat`), across all admin-role panels. `admin-department-report.service.js` `buildInstitutionReportPayload` and `super-admin-report-queue.service.js` `buildDepartmentAcademicPayload` (College-Admin + SuperAdmin no-college single-test path) both emit `meta.assessmentFormat`/`meta.isModuleTest` and enrich `modulePerformance.studentRows` with `rollNo`/`department`/`year`/`status`; `report-formatter.service.js` `moduleAnalyticsSheet` now renders **Reg No, per-module `score/max (%)`, Overall `score/max (%)`, Status, Time** per student, gated on `meta.isModuleTest === true` OR legacy `modulePerformance` presence — OPEN_TEST / multi-test scopes render the standard report unchanged. Covered by `module-report-analytics.test.js` (10 tests: aggregation + formatter columns + test-type gating + `buildInstitutionReportPayload` module payload with enriched student rows + `buildAggregateReportResponse` module defs) and a `buildDepartmentAcademicPayload` module-payload test in `super-admin-report-queue.service.test.js` — both pipelines proven to deliver `meta.isModuleTest`/`assessmentFormat` + `modulePerformance` for a single MODULE_TEST scope and to omit it for OPEN_TEST. **No Excel/CSV export was added — the "old PDF report method" only, per request.** On-screen deep-dive tables (Admin/College-Admin/SuperAdmin `ReportsPage`) now derive their per-module columns from the server's `modulePerformance.modules` (test-type driven, pagination-independent), falling back to the row `moduleScores` shape only for legacy responses — `buildAggregateReportResponse` gained a `modules` defs array to power this on the Super Admin aggregation path.
   7. **Known env caveat:** `validation.integration.test.js` (pre-existing, unrelated to MODULE_TEST) flakes on this slow/contended `mongod` — a `expect(true).toBe(false)` that no longer fires due to auto-provisioned colleges plus a `1000ms` bulk-validation latency threshold only pass in isolation. All module/report suites and the rest of the Backend suite pass.

---

## 1. Current architecture findings

**Backend stack:** Node/Express, MongoDB via a **custom Prisma-style wrapper** (`src/config/db.js`, ~1600 lines) exposing `db.<model>.findUnique/findMany/create/createMany/update/updateMany/upsert/count/$transaction`. Mongoose schemas live in `src/models/validation/*` and are mostly `strict:false` (extra fields persist silently).

**The "attempt" is two records, not the `Attempt` schema.**
- `src/models/attempt.schema.js` registers an `Attempt` model but it is **dead code** — no controller/service/route references it (confirmed by grep). Ignore it (or leave it; do not build on it).
- Real attempt state = **`submission`** (score/status/answers/violations, `src/models/validation/submission.schema.js`, `strict:false`) **+ `testSession`** (ephemeral timing: `startedAt`, `expiresAt`, `endedAt`, `lastHeartbeatAt`, `connectionStatus`, `clientSessionId`, `submissionId`; **schemaless** — managed only by the db wrapper defaults, no Mongoose file).
- `answer` documents hold per-question responses (`submissionId_questionId` unique upsert).

**Timer is already server-authoritative.** `testSession.expiresAt = startedAt + durationMins*60000`. `startTest`/`getSession`/`heartbeat`/`saveAnswer`/`submit` all re-check `isSubmissionExpired(submission, session)` and force auto-submit. The client's `useAttemptTimer` counts down to `server_end_time` using a captured `clock_offset_ms` (never the raw device clock).

**Student lifecycle** (`src/controllers/Students/tests.controller.js`, 1796 lines):
`GET :testId/access` → `POST :testId/agree` → `POST :testId/start` (Redis-locked, creates submission+session, returns sanitized questions + `server_end_time`) → `POST :testId/heartbeat` (buffered via `heartbeat-buffer.service`) / `POST :testId/answer` (upsert answer + progress + presence) / `POST :testId/violation` → `POST :testId/submit` (Redis-locked, `completeSubmission`). Compat routes (`tests-compat.routes.js`) expose `/attempts/:attemptId/...` aliases that resolve the attempt then delegate to the same controllers.

**Scoring** (`src/services/test.service.js`): `calculateSubmissionScore(submissionId)` loads test+questions+answers, iterates **all** questions, applies `isQuestionCorrect` + negative marking → `{score, accuracy, completion, totalQuestions}`. `completeSubmission` guards with an atomic `updateMany({status:IN_PROGRESS})` (race-safe), computes `timeSpentSeconds`, ends the session.

**Admin creation** (`src/controllers/Admin/tests.controller.js` `createTest`, Zod `admin-tests.schema.js`): validates `questions[]` (`type/question/options/correctAnswer/marks/difficulty/topic/explanationVideoUrl`), enforces `totalMarks === Σ marks`, rejects duplicate `type:question`, then `tx.test.create` + `tx.question.createMany` (maps to `prompt/type/correctOption/.../order = index+1`). **No `category` field today.**

**Reporting** (`report-formatter.service.js` 885 lines + `report-pdf.service.js` Puppeteer + `admin-report-queue.service.js`/`super-admin-report-queue.service.js`): queued jobs build a `reportData` payload (`reports.controller.js` `buildReportAnalyticsPayload`), rendered to self-contained inline-SVG HTML → PDF. Institution-level (departments/subjects/questions/performance sheet). Per-attempt result is `getAttemptResult` → `question_breakdown`.

**Redis** (`src/config/redis.js`, fail-open everywhere): exam-state cache (`exam-state-cache.service.js`), heartbeat write-buffer (30s flush, `heartbeat-buffer.service.js`), distributed locks (`redis-lock.service.js`), presence throttle, rate limits, Socket.IO coordination.

**Frontend:** admin `TestCreationDialog.jsx` (2257 lines) + `testCreationSlice.js`; student `TestEnvironmentPage.jsx` (521) + `testSlice.js` (634) + hooks `useAttemptTimer/useAttemptAutosave/useAttemptHeartbeat/useProctoringGuard`; `test-engine/` renderers + `TestNavigationPanel`. Payload contract: `question_order[]`, `questions{}`, `answers{}`, `server_end_time`, `clock_offset_ms`, `test_type`, `proctoring_config`.

---

## 2. Existing files/components/models affected

**Backend — schema/config**
- `src/models/validation/test.schema.js` — add `assessmentFormat`, `modules[]` (strict:false already, but declare for clarity).
- `src/models/validation/question.schema.js` — add `category`.
- `src/models/validation/submission.schema.js` — add `moduleState[]` + overall module fields (via `metadata`/strict:false).
- `src/config/db.js` — add defaults for new test fields (`assessmentFormat`, `modules`); testSession is schemaless (no change needed to store module timing, but add defaults for clarity); add indexes.
- `src/services/test-config.service.js` — add `ASSESSMENT_FORMATS`, `MODULE_DEFINITIONS` (fixed order), `normalizeAssessmentFormat`, `resolveModules`, extend `attachResolvedTestConfiguration` to surface `assessment_format` + module timing to students.

**Backend — admin**
- `src/schemas/Admin/admin-tests.schema.js` — conditional validation for `assessmentFormat` + `modules[]` + per-question `category`.
- `src/controllers/Admin/tests.controller.js` — `createTest`/`updateTest`/clone: persist `assessmentFormat`+`modules`, map `category`, compute `durationMins = Σ module durations`.
- `src/controllers/Admin/question-bank.controller.js` — category passthrough where relevant.

**Backend — student runtime**
- `src/controllers/Students/tests.controller.js` — module-aware `startTest`, new module state in `getSession`/`getAttemptSession`, new `advanceModule` transition, module-scoped question payload, module-deadline expiry.
- `src/schemas/Students/tests.schema.js` — new `advanceModuleSchema`; extend save/submit to accept `moduleKey`.
- `src/routes/Students/tests.routes.js` + `tests-compat.routes.js` — add module transition route + rate limiter.
- `src/services/test.service.js` — `calculateSubmissionScore` extended to compute per-module breakdown when `assessmentFormat==='MODULE_TEST'`; `completeSubmission` finalises module state.
- `src/services/exam-state-cache.service.js` — extend state with `currentModuleKey`, `moduleExpiresAt`.
- `src/services/answer.service.js` / `submission-batch.service.js` — module tagging on autosave (optional, category is derivable from question).

**Backend — reporting/analytics**
- `src/services/report-formatter.service.js` — module-aware section layout switch on `assessmentFormat`.
- `src/controllers/Admin/reports.controller.js` + `report-analytics-aggregation.service.js` + `admin-department-report.service.js` — per-module aggregation; admin tables expose Quant/Reasoning/Verbal/Overall columns.
- `src/controllers/Students/tests.controller.js` `getAttemptResult` + `src/controllers/Students/reports.controller.js` — per-section result payload.

**Frontend**
- `src/components/Admin/TestCreationDialog.jsx` + `src/features/Admin/testCreationSlice.js` + `src/lib/testConfig.js` — format selector + 3 module-duration inputs + category import guidance.
- `src/pages/Students/TestEnvironmentPage.jsx` + `src/features/Students/testSlice.js` + `src/hooks/useAttemptTimer.js` (reused) — module stepper, per-module timer, transition handling, "no future/previous module" guard.
- `src/components/Students/test-engine/TestNavigationPanel.jsx` — scope navigation to current module.
- `src/pages/Students/ResumeAttemptPage.jsx` — resume into correct module.
- Reports pages (`src/pages/Students/ReportsPage.jsx`, admin analytics views) — module columns.

---

## 3. Proposed database/schema changes (no destructive migration)

All target collections are `strict:false` (or schemaless), so **legacy documents remain valid with fields simply absent**. No backfill required; code defaults absent → OPEN_TEST.

### 3.1 `test`
```
assessmentFormat: { type: String, enum: ["OPEN_TEST","MODULE_TEST"], default: "OPEN_TEST" }
modules: [{
  key:        String,   // "QUANT" | "REASONING" | "VERBAL"  (stable machine key)
  name:       String,   // "Quantitative Aptitude" | "Logical Reasoning" | "Verbal"
  order:      Number,   // 1,2,3 (fixed)
  durationMins: Number, // required per module, >=1
  category:   String,   // canonical category string matched against question.category
}]
// durationMins (existing) := sum of module durations for MODULE_TEST (kept in sync so
// every legacy consumer that reads test.durationMins still gets the correct total).
```
`modules` empty/absent ⇒ OPEN_TEST. Fixed order & set enforced server-side (admin cannot reorder/add/remove).

### 3.2 `question`
```
category: { type: String, default: null }  // "Quantitative Aptitude" | "Logical Reasoning" | "Verbal"
```
- OPEN_TEST: `category` stays `null` (current behaviour, no validation).
- MODULE_TEST: required, must be one of the 3 allowed values (validated at import).
- Existing `order` field is reused; within MODULE_TEST, module grouping is derived from `category`, and per-module display order is `order` within that category (no manual position assignment — satisfies "do not make admin assign positions").

### 3.3 `submission` (module attempt metadata) — stored under a new top-level `moduleState` (strict:false)
```
moduleState: [{
  key, name, order, category,
  configuredDurationMins,
  startedAt, endedAt,
  timeTakenSeconds,
  status: "NOT_STARTED"|"ACTIVE"|"MANUAL_SUBMIT"|"AUTO_SUBMIT"|"EXPIRED"|"COMPLETED",
  score, maxScore, percentage
}]
currentModuleKey: String|null          // authoritative pointer to active module
moduleExpiresAt:  Date|null            // server deadline for the active module
// Overall fields reuse existing submission.score/accuracy; add:
overallMaxScore, overallPercentage, totalConfiguredDurationMins, totalActualTimeSeconds
```
OPEN_TEST submissions never get `moduleState` ⇒ every existing reader is unaffected.

### 3.4 `testSession` (schemaless — authoritative timing)
Add per-attempt module timing (no schema file to change):
```
currentModuleKey, moduleExpiresAt, moduleOrder
// expiresAt (existing) := whole-test hard cap = startedAt + Σ durations (safety net)
```

### 3.5 Indexes (add only if load justifies)
- `question`: **compound `{ testId: 1, category: 1, order: 1 }`** — needed: module question fetch filters by testId+category ordered by order. (Replaces/augments any testId-only index.)
- `submission`: existing `{userId,testId,attemptNumber}` unique + `{testId,status}` are sufficient; **no new index** for module reads (module data is embedded in the submission doc).
- `test`: no new index (`assessmentFormat` is low-cardinality; queries already scope by collegeId/status).
- **Do not** add indexes on `assessmentFormat`, `moduleState.*` — low selectivity / embedded.

---

## 4. Proposed API changes

Principle: **extend existing endpoints; add exactly ONE new endpoint** (module transition). All respect existing RBAC + college/department scoping middleware (unchanged).

### 4.1 Admin — create/update (extend existing)
`POST /api/admin/tests` and `PATCH /api/admin/tests/:testId` (existing `createTest`/`updateTest`).
- **Body additions:** `assessmentFormat`, `modules:[{key,durationMins}]` (names/order/category injected server-side from canonical `MODULE_DEFINITIONS`, not trusted from client), per-question `category`.
- **Validation:** see §6. For MODULE_TEST: exactly 3 modules, each `durationMins` integer ≥1 (and ≤ sane max, e.g. 300), every question has a valid category, all 3 categories represented.
- **Auth:** unchanged (`authenticate` + admin RBAC + department scope).
- **Response:** existing test payload + `assessmentFormat` + `modules`. `durationMins` = Σ.
- **Errors:** `422 MODULE_DURATION_INVALID`, `422 MODULE_CATEGORY_MISSING`, `422 MODULE_CATEGORY_INVALID`, `422 MODULE_EMPTY` (a module has 0 questions), plus row-level import errors (§6).
- **Idempotency:** create is a single `$transaction` (test + questions + testBatch) — unchanged.

### 4.2 Student — access/start (extend existing)
`GET /api/tests/:testId/access` → add `assessment_format`, `modules[]` (name/order/duration, **no questions/answers**).
`POST /api/tests/:testId/start` → when MODULE_TEST:
- Initialise `moduleState` (all `NOT_STARTED`), set `currentModuleKey = QUANT`, `status ACTIVE`, `moduleStartedAt = now`, `moduleExpiresAt = now + quantDuration`, `testSession.expiresAt = now + Σ` (hard cap).
- Response returns **only the current module's** sanitized questions + `module`:{key,name,order,duration,server_module_end_time}, plus `server_end_time` (whole-test cap for safety). Redis-locked (existing `lock:test-start`).
- Resume path: recompute current module from `moduleState` + server clock (see §8 state machine); if `moduleExpiresAt` passed, auto-advance server-side before responding.

### 4.3 Student — NEW: advance module
`POST /api/tests/:testId/module/advance` (+ compat `POST /api/attempts/:attemptId/module/advance`).
- **Body:** `{ submissionId, fromModuleKey, clientSessionId }`.
- **Auth:** `authenticate` + `assertSessionOwnership`.
- **Trigger:** student "Submit module & continue", OR client detects module timer hit 0 (server re-verifies).
- **Behaviour (Redis-locked `lock:test-module:submission:{id}`):**
  1. Verify `fromModuleKey === currentModuleKey` (else it's a duplicate/stale request → return current state idempotently, `200 { alreadyAdvanced:true }`).
  2. Finalise `from` module: `endedAt=now`, `timeTakenSeconds`, `status = EXPIRED` if past `moduleExpiresAt` else `MANUAL_SUBMIT`, compute module score.
  3. If a next module exists: set it ACTIVE, `moduleStartedAt=now`, **`moduleExpiresAt = now + nextDuration`** (fresh — unused time never carries over), update `testSession`.
  4. If no next module: `completeSubmission` (whole attempt) → `COMPLETED`.
- **Response:** next module's questions + `server_module_end_time`, or `{ completed:true, summary }`.
- **Errors:** `409 MODULE_MISMATCH` (handled idempotently), `409 SUBMISSION_ALREADY_COMPLETED`, `429 MODULE_ADVANCE_LOCKED`.
- **Idempotency/race:** lock + `fromModuleKey` guard + atomic `updateMany({currentModuleKey: fromKey})` conditional write.

### 4.4 Student — answer/heartbeat/session/submit (extend existing)
- `POST /:testId/answer`: additionally reject answers whose question's category ≠ `currentModuleKey`'s category → `403 QUESTION_NOT_IN_ACTIVE_MODULE` (prevents cross-module writes / future-module poking). Expiry check uses **`moduleExpiresAt`** for MODULE_TEST.
- `GET /:testId/session` & `/attempts/:attemptId`: return current-module scoped questions + `server_module_end_time`; auto-advance if module expired (idempotent).
- `POST /:testId/submit`: for MODULE_TEST means "submit current module" → delegates to advance logic; final module submit completes the attempt. (Kept working so existing client submit still functions.)
- `POST /:testId/heartbeat`: unchanged mechanics; also refreshes exam-state `moduleExpiresAt`.

### 4.5 Reports (extend existing) — no new pipeline
- `GET /api/admin/reports/*` and job generation gain module sections when `assessmentFormat==='MODULE_TEST'` (§11).
- `GET /api/results/:attemptId` (`getAttemptResult`) returns `sections[]` for MODULE_TEST.

---

## 5. Admin UI changes (`TestCreationDialog.jsx` + `testCreationSlice.js` + `lib/testConfig.js`)

- Add **Assessment Format** selector: `OPEN_TEST` (default) | `MODULE_TEST`.
- **OPEN_TEST selected:** dialog unchanged (single `durationMins`, current bulk import, no category) — zero behavioural change.
- **MODULE_TEST selected:**
  - Render the 3 fixed modules in fixed order (Quant → Reasoning → Verbal), each with a **minutes input** (required, integer ≥1). Order is read-only.
  - Show total = Σ (drives `durationMins`); hide/disable the single-duration input.
  - Show category requirement banner + the expected JSON shape with `"category"` and the 3 allowed values.
  - Bulk-import preview groups parsed questions by category, shows counts per module, and surfaces row-level errors (missing/invalid category, empty module) **before submit**.
  - Client-side mirror of server validation (server remains source of truth).
- `lib/testConfig.js`: add `ASSESSMENT_FORMATS`, `MODULE_DEFINITIONS`, allowed categories.

## 6. Bulk JSON import changes

Single source of truth: a shared validator (add to `test-config.service.js` or a small `module-import.service.js`) used by both admin create/update and the Zod schema layer.

- **OPEN_TEST:** existing rules unchanged (no category required; `category` ignored/nulled).
- **MODULE_TEST**, per question:
  - `category` present, string (not array), ∈ {Quantitative Aptitude, Logical Reasoning, Verbal} → else row error.
  - Existing structural validation reused (type, options≥2 for mcq, correctAnswer∈options, marks, etc.).
  - Duplicate detection reused (`type:question` normalized).
- **Aggregate:** all 3 categories must have ≥1 question (`MODULE_EMPTY` otherwise). `totalMarks === Σ marks` reused.
- **Error shape:** `{ errors: [{ index, field, code, message }], summary: { perCategoryCounts } }` — row/question-level, matching existing 422 error envelope.
- **Persistence:** `tx.question.createMany` maps `category` through; `order` assigned per existing `index+1` (module grouping stays category-driven at read time → no manual positions).

## 7. Student test UI changes (`TestEnvironmentPage.jsx` + `testSlice.js`)

- Add module-aware state to `testSlice`: `assessment_format`, `modules[]`, `current_module` {key,name,order}, `server_module_end_time`, plus existing `question_order/questions/answers` now scoped to the active module only.
- Header stepper: `[ Quant ] [ Reasoning ] [ Verbal ]` with current highlighted, completed marked done, future disabled.
- Timer: reuse `useAttemptTimer` driven by `server_module_end_time`; on expiry call `module/advance` (server re-verifies). Copy makes clear the timer belongs to the current module only.
- Navigation panel scoped to current-module questions; **no UI path to previous/future modules**.
- Transition UX: "Submit module & continue" → confirm → `advance` → load next module (or results). Auto-advance on expiry with a brief "Time up — moving to next section" state.
- Resume (`ResumeAttemptPage`/reload): server returns the correct active module + remaining module time; client never trusts local clock (existing `clock_offset_ms` pattern).

## 8. Timer & attempt state-machine design (server-authoritative)

**States** (on `submission.status` + `moduleState[].status` + `currentModuleKey`):
```
NOT_STARTED → QUANT_ACTIVE → REASONING_ACTIVE → VERBAL_ACTIVE → COMPLETED
```
Each `*_ACTIVE` module resolves to one of `MANUAL_SUBMIT | AUTO_SUBMIT(violations) | EXPIRED(timer)` on exit; `COMPLETED` also reachable via global auto-submit (inactivity/violation cap).

**Authority:** `testSession.moduleExpiresAt` + `submission.currentModuleKey` are the truth. `testSession.expiresAt` = whole-test hard cap (`Σ durations`) as a safety net. Client timers are display-only.

**Transitions** (who / DB / Redis / answers / duplicate / concurrency):

| Transition | Trigger | DB writes | Redis | Unanswered Qs | Saved answers | Duplicate request | Concurrent requests |
|---|---|---|---|---|---|---|---|
| start → QUANT_ACTIVE | student `start` | submission.moduleState init, currentModuleKey=QUANT; testSession expiresAt+moduleExpiresAt | exam_state incl. currentModuleKey/moduleExpiresAt | scored 0 later | persisted | Redis `lock:test-start`; resume returns existing | lock serialises; resume branch |
| module N → N+1 | student advance OR module timer expiry (server-verified) | finalise module N (endedAt/time/score/status), set N+1 ACTIVE + fresh moduleExpiresAt | update exam_state module fields | module N unanswered = 0 marks | retained, locked from further edit (category guard) | `fromModuleKey` guard → idempotent 200 | `lock:test-module:{sub}` + conditional `updateMany({currentModuleKey:fromKey})` |
| last module → COMPLETED | advance on last / expiry / violation cap | `completeSubmission` (atomic IN_PROGRESS guard), finalise all modules, overall totals | clearExamState | 0 marks | retained | `completeSubmission` no-ops if not IN_PROGRESS | existing submit lock + atomic guard |
| any → AUTO_SUBMIT | violation cap / inactivity (existing paths) | complete + mark remaining modules EXPIRED | clearExamState | 0 marks | retained | idempotent | existing locks |

**No carry-over:** each module's `moduleExpiresAt` is `now + thatModuleDuration` computed at the moment it becomes ACTIVE — finishing early gives the next module exactly its own configured minutes.

## 9. Autosave / heartbeat changes

- Reuse `heartbeat-buffer.service` unchanged (per-test batched flush). Heartbeat additionally reads/writes `moduleExpiresAt` in exam-state (Redis) — **no extra Mongo writes**.
- Autosave: reuse `saveAnswer`/`bulkSaveAnswers`; add the category-vs-active-module guard. Module boundary flushes pending saves (client `flushPendingSaves`) before calling `advance`.
- Timer expiry mid-save race: `advance`/save both re-check `moduleExpiresAt` server-side; a save arriving after expiry for the just-closed module is rejected (`403 QUESTION_NOT_IN_ACTIVE_MODULE`) — the answer was already captured or the module is closed (documented edge case #15).

## 10. Scoring changes (`test.service.js`)

- Extend `calculateSubmissionScore`: if `assessmentFormat==='MODULE_TEST'`, group questions by `category`, run the **existing** `isQuestionCorrect` + negative-marking per group, produce `sections[{key,name,score,maxScore,percentage}]` + overall (Σ). A question is always scored against its own category's module. OPEN_TEST path unchanged (single pass).
- `completeSubmission` writes `moduleState[].score/maxScore/percentage`, `overallMaxScore`, `overallPercentage`, `totalActualTimeSeconds` (Σ module times), keeps `submission.score/accuracy` as overall (so every existing reader still works).
- **No duplicated scoring logic** — same primitives, grouped.

## 11. Report / PDF changes (`report-formatter.service.js` + queues) — extend, don't fork

- Keep OPEN_TEST report output **identical** (switch on `assessmentFormat`).
- MODULE_TEST per-student report adds a **Section Performance** block (Quant/Reasoning/Verbal each: score, maxScore, %, configured duration, actual time) + **Overall** (score, maxScore, %, total configured duration, total actual time, test start, test completion). Reuse existing inline-SVG primitives (`svgBarList`, `kpiCard`, tables) — no external assets (Puppeteer constraint preserved).
- Admin module-level tables gain columns: Quant / Reasoning / Verbal / Overall / duration / actual time per student, sourced from `submission.moduleState` (no re-derivation).
- Same queued pipeline (`admin-report-queue`/`super-admin-report-queue` + `report-pdf` Puppeteer). Report generated before finalisation edge case (#23): report reads only finalised submissions (existing `REPORTABLE_SUBMISSION_STATUSES`); in-progress modules simply show as incomplete.

## 12. Analytics changes

- `report-analytics-aggregation.service.js` + admin analytics: when the scoped test is MODULE_TEST, compute module-wise avg/max/%/completion/time from `submission.moduleState`; overall avg + score distribution reuse existing logic on overall score.
- OPEN_TEST analytics untouched (guarded by `assessmentFormat`).

## 13. Validation & edge cases (all 25 addressed)

1. Zero duration → `422 MODULE_DURATION_INVALID`. 2. Negative → same. 3. Very large → cap (≤300 min/module) `422`. 4. Missing category (MODULE_TEST) → row error `MODULE_CATEGORY_MISSING`. 5. Invalid category → `MODULE_CATEGORY_INVALID`. 6. Questions from only one module → `MODULE_EMPTY` for the others. 7. Missing for one module → `MODULE_EMPTY`. 8. Duplicate imports → existing duplicate guard. 9–11. Refresh in any module → `start`/`session` recompute active module + remaining module time from server. 12. Disconnect → heartbeat stale handling (existing) within module deadline. 13. Reconnect after expiry → server auto-advances/auto-submits. 14. Submit before end → `advance` finalises early, no carry-over. 15. Expiry during in-flight save → server re-check rejects late cross-module save. 16. Simultaneous transitions → lock + `fromModuleKey` guard + conditional write. 17. Direct future-module API call → questions filtered to `currentModuleKey`; category guard on save → `403`. 18. Reopen previous module → not ACTIVE → `403`/idempotent. 19. Modify timer fields → client never trusted; server recomputes from `testSession`. 20. Multiple tabs → existing `clientSessionId` takeover applies per attempt. 21. Backend restart → state in Mongo (`submission`/`testSession`) survives; recompute on next request. 22. Redis restart → fail-open; timers derive from `testSession.moduleExpiresAt` (Mongo). 23. Report before finalised → only reportable statuses. 24. Legacy test w/o `assessmentFormat` → treated OPEN_TEST. 25. Legacy question w/o `category` → OPEN_TEST scoring/read unaffected.

## 14. Backward-compatibility strategy

- New fields are additive on `strict:false`/schemaless collections → **no migration**, legacy docs valid.
- `assessmentFormat` absent ⇒ `OPEN_TEST` at every read (`normalizeAssessmentFormat`).
- OPEN_TEST code paths are the untouched default branch everywhere (create, start, save, submit, score, report, analytics).
- `durationMins` remains authoritative total for OPEN_TEST and is kept = Σ for MODULE_TEST so legacy consumers (timers, reports, exports) keep working.
- Existing tests, submissions, answers, sessions, reports continue to function with zero data changes. Optional idempotent backfill script (set `assessmentFormat:"OPEN_TEST"` explicitly) is **not required**, only cosmetic.

## 15. Redis / performance considerations

- No new per-tick Mongo writes: module deadline lives in exam-state (Redis) + `testSession` (written on transitions only, ~2 extra writes per attempt total).
- Heartbeat buffering, presence throttle, locks reused as-is.
- Module transition is O(1), Redis-locked per submission — safe under concurrent exam end spikes.
- Question payload per module is *smaller* than whole-test payload; test-cache can cache per-(test,category). Scalability target preserved.

## 16. Security / RBAC considerations

- All new/extended routes keep `authenticate` + existing admin RBAC + college/department scope middleware; Super/College/Department admin rules unchanged.
- Students can only touch their own attempt (existing `assertSessionOwnership`) and only the **active** module (category guard) — cannot read/write future or completed modules.
- Timer/module fields are server-computed and never accepted from the client (anti-manipulation).
- Question sanitisation (`stripSensitiveQuestionFields`) applies unchanged to module questions.

## 17. Testing strategy

- **Unit:** module validator (categories/durations/empty), `calculateSubmissionScore` per-module grouping, state-machine transitions (start/advance/complete, idempotency, no carry-over), expiry math.
- **Integration:** full MODULE_TEST lifecycle (start→advance×2→complete), resume mid-module, expiry auto-advance, concurrent advance (lock), cross-module save rejection, OPEN_TEST regression (must stay identical).
- **Report/analytics:** module-aware payload + PDF snapshot; OPEN_TEST report byte-compat test.
- **Frontend:** slice reducers for module state, timer per module, stepper guards; reuse existing `useAttemptTimer/Autosave/Heartbeat` integration tests + new module cases.
- Extend existing suites in `src/tests/unit/*` and `Frontend/src/**/*.test.*` rather than new frameworks.

## 18. Deployment considerations

- No schema migration, no downtime. Deploy backend (additive) → frontend. Feature is inert until an admin creates a MODULE_TEST.
- Backward/forward compatible payloads (old client ignores new fields; MODULE_TEST simply unavailable until frontend ships).
- Preserve Puppeteer/report queue infra (`deploy/`, PM2/systemd) unchanged.
- Roll-back safe: MODULE_TEST tests created before rollback still read as OPEN_TEST would be wrong → gate creation behind the deployed backend; document that MODULE_TEST tests require the new backend.

## 19. File-by-file implementation plan

**Backend**
1. `test-config.service.js` — `ASSESSMENT_FORMATS`, `MODULE_DEFINITIONS`, `normalizeAssessmentFormat`, `resolveModules`, module validator, extend `attachResolvedTestConfiguration`.
2. `models/validation/test.schema.js` — declare `assessmentFormat`, `modules`.
3. `models/validation/question.schema.js` — declare `category`.
4. `config/db.js` — test defaults (`assessmentFormat`, `modules`); `question` compound index `{testId,category,order}`.
5. `schemas/Admin/admin-tests.schema.js` — conditional MODULE_TEST validation + per-question `category`.
6. `controllers/Admin/tests.controller.js` — create/update/clone persist format+modules+category, `durationMins=Σ`.
7. `services/test.service.js` — per-module scoring + module finalisation in `completeSubmission`.
8. `controllers/Students/tests.controller.js` — module-aware start/session/save/submit + `advanceModule`.
9. `schemas/Students/tests.schema.js` — `advanceModuleSchema`, `moduleKey` on save/submit.
10. `routes/Students/tests.routes.js` + `tests-compat.routes.js` — advance route + limiter.
11. `services/exam-state-cache.service.js` — module fields in state.
12. `services/report-formatter.service.js` + `reports.controller.js` + `report-analytics-aggregation.service.js` + `admin-department-report.service.js` — module report/analytics.
13. `controllers/Students/reports.controller.js` + `getAttemptResult` — `sections[]`.

**Frontend**
14. `lib/testConfig.js` — formats, module defs, categories.
15. `features/Admin/testCreationSlice.js` + `components/Admin/TestCreationDialog.jsx` — format selector, module durations, category import UI.
16. `features/Students/testSlice.js` — module state + `advanceModule` thunk.
17. `services/studentApi.js` — `advanceModule` call.
18. `pages/Students/TestEnvironmentPage.jsx` + `test-engine/TestNavigationPanel.jsx` + `ResumeAttemptPage.jsx` — stepper, per-module timer, guards.
19. Reports pages — module columns/sections.

## 20. Recommended implementation order

1. Config + schema fields + validator (foundation, no behaviour change). 2. Admin create/update + Zod + import validation. 3. Admin UI (create MODULE_TEST end-to-end, verify persistence). 4. Per-module scoring. 5. Student runtime: start + module state + advance + guards (server). 6. Student UI: stepper + per-module timer + transitions + resume. 7. Result payload `sections[]` + student result UI. 8. Reports/analytics module-aware. 9. Tests throughout. 10. OPEN_TEST regression sweep before merge.

## 21. Risks & mitigation

- **Name collision with `testType`** → mitigated by separate `assessmentFormat` field (§0).
- **Timer manipulation / carry-over bugs** → server-authoritative `moduleExpiresAt` recomputed on transition; unit tests for no-carry-over.
- **Race on module transition** → Redis lock + `fromModuleKey` conditional write + idempotent responses.
- **Breaking OPEN_TEST** → default-branch everywhere + regression tests + byte-compat report snapshot.
- **Redis outage** → fail-open; timing falls back to `testSession` (Mongo).
- **Report queue coupling** → extend formatter only, same pipeline/Puppeteer.
- **`totalMarks === Σ` invariant** → import validator keeps it per existing rule.

## 22. Final acceptance criteria

- OPEN_TEST: creation, import, timer, student UI, attempt/submit, scoring, report/PDF, analytics, and APIs **unchanged** (regression tests green; no DB migration).
- Admin can create a MODULE_TEST with 3 fixed-order modules, independent required minute durations, category-tagged bulk import with row-level errors; `durationMins`=Σ.
- Student flow always Quant→Reasoning→Verbal→Completed; each module has its own server-authoritative timer; unused time never carries over; no access to future/previous modules; robust across refresh/disconnect/reconnect/multi-tab/backend+Redis restart/duplicate+concurrent requests.
- Scoring produces per-module score/max/% and overall score/max/%; each question scored against its own category.
- Reports/analytics render module-aware sections + admin module columns via the existing queued Puppeteer pipeline; OPEN_TEST reports unchanged.
- All 25 edge cases handled; RBAC/scoping preserved; timer fields never trusted from client.
- Legacy tests/questions/submissions/reports without the new fields keep working as OPEN_TEST.
