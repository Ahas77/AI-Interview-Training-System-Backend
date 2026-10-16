# C3: non-invasive coaching and progress sidecar

C3 observes successful requests in the existing interview system, then stores its own metadata after the response finishes. Teammates do not need to call C3 from their controllers. C3 does not edit their request/response bodies, run AI inside their endpoints, upload camera images, or write to their tables.

Missing inputs remain missing. A working interview history does not imply that face, voice or answer scoring components are already connected.

## Run and disable

Run the backend normally with `npm run dev`. After the original `initDB()` returns, `initC3()` creates eight C3 tables. It catches its own migration failure so the interview server can still start. Existing shared authentication and `AIProvider` are reused; no new key, SDK, package or dependency is required.

Disable the observer by adding this to the existing backend `.env` and restarting:

```env
C3_OBSERVER=off
```

The default is on. Off disables observation entirely; the C3 routes and stored history still exist. A C3 migration failure, dropped observation or full queue never changes an interview response. The queue is in memory and is not a durable message broker: an abrupt process exit can lose pending observations. Backfill recovers saved metadata but cannot recover unknown historical timing.

Commands, from the backend directory:

```powershell
node src/c3/db/initC3.js
node src/c3/scripts/backfill.js
node --test src/c3/tests/*.test.js
```

The migration is idempotent and uses only `CREATE TABLE IF NOT EXISTS c3_...`. Backfill is manual, repeatable, and reads existing shared sessions/answers. It does not invent historical answer latency. It fills missing values while preserving recorded C3 scores/timing. Run backfill after deploying this sidecar so old interview history appears.

Optional integration verification creates and deletes a fresh database named `c3_sidecar_verify_<timestamp>`. It needs local MySQL credentials with permission to create/drop that disposable database, and never uses the real project database for fixtures:

```powershell
$env:C3_INTEGRATION='1'
node --test src/c3/tests/integration.test.js
Remove-Item Env:C3_INTEGRATION
```

Do not use `npm test` for this module: the earlier C3 package.json changes were removed for merge safety. Use the explicit command above. Unit tests require no database or external AI call. The opt-in integration test uses mocked AI, checks actual MySQL/API behavior, and boots the actual server with observation on and off.

## Storage and the approved warm-up adjustment

Positive API `sessionId` values are real `interview_sessions.id` values. A warm-up is a C3-only `c3_session_meta` row with `session_id=NULL` and type `warmup`; its public API ID is the negative value of that metadata row's ID. For example, `-8` is a C3 warm-up, never a shared interview. This avoids adding or modifying shared interview rows. Signals/baselines use `warmup_id` for that record, with their shared `session_id` left null.

| New table | Contents and references |
| --- | --- |
| `c3_session_meta` | C3 type, per-user interview number, completion and creation dates; nullable unique FK to shared interview and FK to user. Also holds independent C3 warm-ups. |
| `c3_question_events` | First question delivery and first answer receipt, with `DATETIME(3)` timestamps; FKs to shared session/question; unique session/question/event key. |
| `c3_answer_meta` | Type, word count, response latency, optional score/source; one row per shared question with session/question FKs. |
| `c3_signals` | Numeric metrics, source, relative time and optional model/version/confidence; shared session or C3 warm-up FK, optional question FK. |
| `c3_user_baselines` | Versioned mean/std/n per metric, coverage confidence, source and user/session/warm-up FKs. |
| `c3_coaching_tips` | Evidence, tip/practice, approach, baseline version, before/after deviation, followed status and outcome; user/session/question FKs. |
| `c3_self_ratings` | Improvement, clarity and usefulness ratings plus optional comment; unique user/session and both FKs. |
| `c3_drift_events` | Indicator, z-score, direction, classification and detection session number; user FK and unique detection key. |

All foreign keys use `ON DELETE CASCADE`. No C3 migration alters any shared table. Old unprefixed C3 tables and old C3-added columns in an existing database are left intact; this change does not delete historical data or automatically copy old unprefixed signal/baseline/tip rows. The active module now reads its own prefixed tables. The original teammate `initDB()` remains byte-for-byte unchanged from the pre-C3 baseline, including its original migrations.

## Observer routes and configurable handlers

`config/observedRoutes.js` is the integration contract. It contains plain arrays of method, regular-expression path pattern, handler name and explicit field paths. Paths refer to `request.body` or `response`; only selected IDs, labels and finite numbers survive into the deferred job. Word count is computed without keeping the answer text. Authorization, passwords, tokens, images and raw API responses are never captured by C3.

| Observed route | Handler | What is recorded |
| --- | --- | --- |
| `POST /api/interview/start` | `start` | Verify session owner; create metadata; record first delivered question. Session ID comes from the response. |
| `POST /api/interview/submit-answer` | `answer` | Receipt time from request arrival, answer word count and latency; next delivered question; completion if returned. |
| `POST /api/interview/complete` | `complete` | Backfill metadata only from saved shared state. |
| `GET /api/interview/session/:id` | `session` | Backfill missing metadata only; does not pretend that historical questions were delivered now. |
| Disabled face placeholder | `faceSignals` | Extract an explicit allowlist of numeric expression indicators, timestamp, optional model/version/confidence. |
| Disabled scoring placeholder | `answerScore` | Extract a finite 0-100 score, optional type and score source, for a question belonging to that interview. |

The middleware wraps JSON capture to extract a bounded snapshot, calls the original `res.json` unchanged, and dispatches work only through `res.once('finish')` plus `setImmediate`. Successful 2xx responses only; failed or unrelated endpoints are ignored. Jobs for one user/session run in order. All capture/dispatch errors are swallowed with a generic log-once message; no raw driver/provider response is logged by C3. At most 100 jobs can be pending; excess work is skipped rather than slowing the interview.

Example future scoring configuration (replace the placeholder only when the real contract exists):

```js
{
  enabled: true,
  method: "POST",
  pattern: /^\/api\/technical\/score$/,
  handler: "answerScore",
  fields: {
    session: ["request.body.interviewSessionId"],
    qa: ["request.body.qaId"],
    score: ["response.data.score"],
    type: ["response.data.question_type"],
    scoreSource: "technical_component"
  }
}
```

Do not use an unrelated component's own session ID as an interview ID just because the numbers happen to match. Do not enable placeholder paths or invent scores. The `faceSignals` handler currently accepts one configured numeric reading per successful request; a component returning batches needs a documented adapter. Face and voice are also accepted directly by the `/signals` batch endpoint.

Read-only inspection of `origin/Baseline-Backend` at `2a81297` found `/api/behavioral-analysis/sessions/:id/baseline`, `/measurements` and `/result`. That component uses **independent behavioral-analysis session IDs**, and its measurement request contains a `samples` batch. Its current contract does not link those IDs to interview/question IDs. Those routes are therefore **not automatically enabled or matched by numeric coincidence**. No teammate branch was merged or changed. C3 can consume their outputs once an explicit interview association and time/unit mapping are available; this does not require changing their controllers. Other inspected backend branches expose the existing HR flow, with no separate technical scoring endpoint in this checkout.

`config/sharedFields.js` is an allowlist of shared columns and optional aliases. Reads use `INFORMATION_SCHEMA` to select only available columns, cache the shape for 60 seconds, and return empty/null data with a generic log-once message if required fields disappear. Add known aliases here for renamed fields. Missing status/timestamps can reduce available analytics rather than crash the main server. Shared reads are `SELECT` only.

## C3 API

All routes below are mounted at `/api/c3` and use existing `verifyToken`. Each session/question/tip write verifies the authenticated user's ownership; admin export endpoints additionally require a signed admin role. Responses are `{success,message,data}`. Invalid IDs/missing arrays return 400, inaccessible records 404, invalid numeric values or insufficient baseline data 422; C3 storage unavailability returns 503. Existing authentication supplies 401/403 behavior.

Representative success: `{"success":true,"message":"C3 request completed.","data":{"inserted":3}}`.
Representative failure: `{"success":false,"message":"Session not found or access denied.","data":null}`.

| Method/path | Body/query example | `data` example or shape |
| --- | --- | --- |
| `POST /signals` | `{"sessionId":12,"qaId":41,"readings":[{"t_sec":4,"source":"face","metrics":{"gaze_off":0.3}}]}` | `{"inserted":1}`; 201 |
| `POST /warmup` | `{}` | `{"sessionId":-8}`; 201; never writes a shared session |
| `POST /baseline/build` | `{"sessionId":-8}`; or `{}` for first-two-interview fallback | `{"status":"ready","baseline":{"version":1,"metrics":{"gaze_off":{"mean":0.2,"std":0.05,"n":10}},"confidence":1,"source":"warmup"}}`; 201 |
| `POST /baseline/refresh` | `{"confirmed":true,"sessionId":-8}`; omit ID to use latest two completed interviews | New baseline version; same shape as build; 201. Without explicit confirmation: 422. |
| `GET /progress/overview` | None | `{"status":"ready","baseline":null,"sessions":[{"session_id":12,"session_number":1,"average_answer_score":null,"average_delivery_deviation":null}]}` |
| `GET /progress/per-type` | None | `{"status":"ready","weakest_type":null,"analysis":[{"question_type":"hr","count":2,"scored_count":0,"status":"insufficient data","average_score":null}]}` |
| `GET /progress/comparison` | None | `{"status":"ready","fixed_threshold_progress":{"raw_average_answer_score_change":5},"baseline_relative_progress":{"delivery_deviation_change":0.3}}` |
| `GET /session/:sessionId` | Path `12` | `{"session":{...},"baseline":{...},"summaries":[...],"coaching_tips":[...]}` |
| `GET /session/:sessionId/questions` | Path `12` | Array of question type/score/word count/latency, metric means/peaks/deviations and signal status |
| `GET /session/:sessionId/findings` | Path `12` | Up to three `{metric,qa_id,rule,evidence,severity,...}` findings |
| `POST /session/:sessionId/analyze` | `{}` | `{"analyzed":4,"note":"Existing component results imported; missing scores are not invented."}`; compatibility action to backfill saved metadata, not an independent AI grading call |
| `GET /drift` | None | `{"status":"ready","events":[{"metric":"gaze_off","z_score":2,"classification":"behaviour_shift","baseline_refresh_suggested":false,...}]}` |
| `POST /coaching/:sessionId/generate` | `{}` | `{"status":"ready","tips":[{"id":1,"tip":"...","why":"measured evidence","practice":"...","outcome_status":"open"}]}`; 201; requires a completed interview |
| `GET /tips` | Optional `?sessionId=12` | Current user's tip array |
| `PATCH /tips/:tipId/followed` | `{"followed":"yes"}`; also `partly`/`no` | `{"tipId":1,"followed":"yes"}` |
| `POST /tips/evaluate` | `{}` | `[{"tip_id":1,"after_value":0.8,"outcome_status":"improved"}]` |
| `GET /tips/outcomes` | None | Current user's tips with before/after and outcome fields |
| `POST /self-rating` | `{"sessionId":12,"improvementRating":4,"tipClarityRating":4,"tipUsefulnessRating":3,"comment":"Clear exercise"}` | `{"sessionId":12}`; one record per user/session; all supplied ratings must be integers 1-5 |
| `GET /evaluation/dataset` | Admin; optional `?includeDemo=true` | `[{"user_id":"user_<hash>","session_id":"session_<hash>","session_number":1,...}]` |
| `GET /evaluation/csv` | Admin; optional `?includeDemo=true` | CSV attachment with the same pseudonymised fields; no names/emails/comments/raw IDs |
| `GET /evaluation/correlation` | Admin; optional `?includeDemo=true` | `{"status":"ready","participant_count":5,"fixed_threshold_spearman":0.7,"baseline_relative_spearman":0.8,...}` or insufficient data |
| `POST /vision/frame` | Legacy compatibility only | 422 explaining that C3 consumes numeric component outputs; never uploads or retains images |

Each `/signals` reading can optionally include `model_name`, `model_version` and `confidence` (0-1). Only these allowlisted metadata fields and numeric metrics are inserted. A maximum of 500 readings and 32 metrics per reading is accepted; each metric name must be alphanumeric/underscore, start with a letter and have at most 80 characters. The existing Express JSON body-size limit still applies; split large batches. Numeric strings, null values masquerading as numbers, empty metrics, invalid sources and negative/nonfinite times are rejected. Omit unavailable measurements rather than sending zero.

`t_sec` means seconds since the **interview** began, or seconds since the C3 warm-up began for negative IDs. `qaId` must belong to that session; it must be null for warm-ups. Keep indicator names, units and provider behavior consistent between baseline and interviews. Do not combine differently scaled providers under one indicator name. C3 preserves source/model provenance in storage, but comparisons assume that the integration supplies consistent metrics.

## Formulas, findings and outcomes

- **Baseline:** per-indicator arithmetic mean; population standard deviation `sqrt(sum((x-mean)^2)/n)` floored at 0.05; reading count `n`. At least three valid readings per indicator. Confidence is minimum retained indicator count / 10, capped at 1; it describes reading coverage, not calibrated model accuracy. Browser word/character counts are excluded from delivery metrics.
- **Fallback:** without a warm-up, the first two completed interview sessions supply a flagged `first_sessions_fallback` baseline. A confirmed refresh without an ID uses the latest two. Versions are appended, never overwritten; the active baseline is the latest version.
- **Question delivery deviation:** `(question mean - personal baseline mean) / max(baseline std, 0.05)`. At least three readings per indicator. Mean absolute standardized deviations produce the question delivery distance. Linked `qaId` readings are preferred; unlinked readings require both known question boundaries and are otherwise excluded.
- **Latency:** request receipt time minus recorded question delivery time. If that event is absent on a live submission, use the shared question's `created_at`; unknown historical latency stays null. This is time to receipt, not a claim about when the student first spoke.
- **Session:** average answered-question distances and available answer scores separately. Delivery closeness does not automatically mean a better answer.
- **Per type:** group answered questions by supplied type, default HR. Show counts, scored counts, averages, per-session trends and difference from the student's overall delivery distance. Require three answers and three actual scores before selecting the lowest-scoring type.
- **Comparison:** separate early/recent windows of up to two sessions, with no overlap. Raw score change = recent score - early score. Relative progress = early delivery distance - recent distance; positive means closer to baseline. The share closer compares absolute distance to the actual baseline mean and excludes missing values. `fixed_threshold_progress` is a legacy API name for raw-score comparison, not a validated hiring pass/fail threshold.
- **Drift:** at least four completed sessions. Compare up to three reference sessions with the latest two using separate windows. `z=(recent mean-reference mean)/max(reference std,0.05)`. Both recent sessions must cross 1.5 in the same direction; reference needs at least two values. Moving closer with non-decreasing score is improvement; moving farther with a lower score is decline; otherwise behavior shift. Without scores or a baseline, remain conservative. Suggest refresh at absolute z >= 3, but never refresh automatically.
- **Findings:** large personal-baseline deviations, concentrated type deviations, recorded scores below 70, recent drift and observed closeness improvements. Sort by severity, deduplicate metric/type, retain top three. Explanations quote actual measurements and rules.
- **Coaching:** the existing `AIProvider` writes strict JSON `{tip,why,practice,approach_label}` from numeric findings. The displayed `why` is always the rule's evidence, not invented LLM reasoning. Invalid/missing output or an 8-second C3 timeout produces a local exercise. C3 does not explain the provider's internals or detect true emotion.
- **Adaptation:** a previously untried tip gets a shorter exercise. A tried tip with no measured change gets a different outline-and-rehearse approach. Tips are reused on repeated generation rather than endlessly duplicated.
- **Outcomes:** compare with the first two strictly later completed interviews, matching question type when supplied. Compare absolute baseline distance, never the raw metric's up/down direction. Difference < -0.05 is improved, > 0.05 worse, otherwise no change. Score tips reverse direction because higher scores are better. Missing before/after or a changed baseline version leaves a delivery tip open. This is observational tracking, not evidence that the tip caused improvement.
- **Evaluation:** per-session changes relative to the first interview, self-ratings and tip counts. HMAC pseudonyms use existing `JWT_SECRET`; if absent, a process-local random secret is used, so pseudonyms change on restart. Demo emails are excluded by default. Use one latest rated eligible session per participant and require at least five participants, with at least five valid pairs per reported correlation. Spearman uses average tied ranks and Pearson correlation of ranks; a constant/insufficient vector gives null. CSV escapes formulas/quotes/newlines.

All tuning thresholds and bounds are in `config/thresholds.js`: drift 1.5/minimum four/reference three/recent two; reading minimum three; std floor 0.05; confidence target ten; outcome margin 0.05/later sessions two; type minimum three; participant minimum five; low score 70; top findings three; refresh multiplier two; baseline/comparison windows two; metric/batch/name/comment/snapshot/queue caps 32/500/80/2000/65536/100; schema cache 60000 ms; version retries five; LLM timeout 8000 ms.

## Manual demo seed

Never runs at startup, during ordinary backfill, or in the normal unit test command. Explicitly run:

```powershell
node src/c3/scripts/seed.js
node src/c3/scripts/seed.js --delete
```

Five reserved users: `c3.sidecar.improving@demo.local`, `c3.sidecar.shifting@demo.local`, `c3.sidecar.declining@demo.local`, `c3.sidecar.flat@demo.local`, `c3.sidecar.improving2@demo.local`. Demo-only password: `C3demo12345!`. Each has a C3-only warm-up, six completed shared interviews with four typed answers, synthetic scores/signals, ratings and coaching/outcomes. No external AI is called. Re-running does not duplicate the six interviews or their signals. This is the sole intentional shared-write exception, confined to reserved demo identities and normal inserts; cleanup deletes only those exact emails with the exact `C3 Sidecar Demo` marker. All data is synthetic and unsuitable as research results.

## Files and exact shared changes

All new runtime/backend C3 code, tests and scripts live here under `src/c3/`: `config`, `db`, `middleware`, `models`, `services`, `controllers`, `routes`, `scripts`, `tests`.

| Folder | Created files |
| --- | --- |
| `config/` | `observedRoutes.js`, `sharedFields.js`, `thresholds.js` |
| `db/` | `initC3.js` |
| `middleware/` | `observer.js` |
| `models/` | `sharedReader.js`, `store.js` |
| `services/` | `analytics.js`, `coaching.js`, `drift.js`, `llm.js`, `observationHandlers.js`, `privacy.js`, `progress.js` |
| `controllers/`, `routes/` | `index.js` in each |
| `scripts/` | `backfill.js`, `seed.js` |
| `tests/` | `boundaries.test.js`, `c3Analytics.test.js`, `c3Progress.test.js`, `coaching.test.js`, `integration.test.js`, `observer.test.js` |
| Module root | `README.md` |

Relative to shared backend baseline `87e8054`, the **only new shared-code additions** are:

```js
// index.js line 17, after body parsing and before teammate routes:
app.use(require("./src/c3/middleware/observer"));
// index.js line 23, after existing route mounts:
app.use("/api/c3", require("./src/c3/routes"));
// index.js line 34, immediately after await initDB():
await require("./src/c3/db/initC3").initC3();
```

The earlier C3 modifications to shared `src/config/db.js`, `src/controllers/interviewController.js` and `src/models/interviewModel.js` were removed with user approval; these files now match baseline `87e8054` exactly. Old C3-only files outside `src/c3/` were moved/replaced, and their package scripts/test override were removed. The unrelated pre-existing `seed:users` command was preserved. No teammate branch was merged. No existing database column/table or uploaded CV was deleted.

The C3-owned frontend companion was adjusted in `CameraCoaching.tsx`, `WarmupPage.tsx`, `SessionDetailPage.tsx` and `c3Api.ts`: no separate image upload; honest component-input wording; refresh imports existing metadata; baseline refresh sends the explicit confirmation flag; evaluation IDs are typed as pseudonym strings. Teammate frontend interview files were not edited for this migration. The root `C3_GUIDE.md` redirects here.

Remaining uncertainty: actual face/voice/scoring routes, how independent component sessions relate to interviews/questions, sample timing/units, missing legacy readings, and model quality. These must be established before claiming full end-to-end C1/C2 measurement integration. The observer provides automatic collection for the existing interview contract without requiring colleagues to change or be messaged.
