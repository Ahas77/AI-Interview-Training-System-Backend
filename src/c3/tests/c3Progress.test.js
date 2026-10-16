const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../models/store");
const service = require("../services/progress");
const { pool } = require("../../config/db");

test.after(() => pool.end());

function fixture(t, values, scores = values.map(() => 70)) {
  const sessions = values.map((_, i) => ({ id: i + 1, session_number: i + 1, status: "completed" }));
  t.mock.method(model, "getInterviewSessionsForUser", async () => sessions);
  t.mock.method(model, "getSessionForUser", async (id) => sessions.find((session) => session.id === id));
  t.mock.method(model, "getLatestBaseline", async () => ({ version: 1, metrics: { gaze_off: { mean: 0.5, std: 0.1, n: 10 } } }));
  t.mock.method(model, "getQALogsForSession", async (id) => [{ id, question_type: "technical", question_number: 1,
    user_answer_text: "A saved answer", answer_score: scores[id - 1], question_start_sec: 0, answer_end_sec: 10 }]);
  t.mock.method(model, "getSignalsForSession", async (id) => [1, 2, 3].map((time) => ({ qa_id: id, t_sec: time, metrics: { gaze_off: values[id - 1] } })));
  t.mock.method(model, "getSelfRatings", async () => []);
  return sessions;
}

test("two-session progress uses disjoint windows and distance from the baseline, not zero", async (t) => {
  fixture(t, [0.1, 0.4], [50, 80]);
  const result = await service.progressComparison(1);
  assert.equal(result.fixed_threshold_progress.raw_average_answer_score_change, 30);
  assert.equal(result.baseline_relative_progress.delivery_deviation_change, 3);
  assert.equal(result.baseline_relative_progress.share_metrics_moved_closer_to_baseline, 1);
});

test("history is available without a baseline", async (t) => {
  fixture(t, [0.4]);
  t.mock.method(model, "getLatestBaseline", async () => null);
  const result = await service.progressOverview(1);
  assert.equal(result.status, "ready");
  assert.equal(result.sessions[0].average_answer_score, 70);
  assert.equal(result.sessions[0].average_delivery_deviation, null);
});

test("drift uses separate windows and requires a sustained change", async (t) => {
  fixture(t, [0.2, 0.2, 0.6, 0.6]);
  t.mock.method(model, "insertDriftEvent", async () => {});
  const result = await service.detectDrift(1);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].z_score, 8);
});

test("one unusual session does not trigger sustained drift", async (t) => {
  fixture(t, [0.2, 0.2, 0.2, 0.8]);
  const result = await service.detectDrift(1);
  assert.deepEqual(result.events, []);
});

test("tips are not evaluated against the source session or earlier sessions", async (t) => {
  fixture(t, [0.1, 0.2]);
  t.mock.method(model, "getTipsForUser", async () => [{ id: 1, session_id: 2, metric: "gaze_off", outcome_status: "open", before_value: 3 }]);
  assert.deepEqual(await service.evaluateOpenTips(1), []);
});

test("tip outcome compares absolute deviations rather than raw indicator direction", async (t) => {
  fixture(t, [0.1, 0.4]);
  t.mock.method(model, "getTipsForUser", async () => [{ id: 1, session_id: 1, metric: "gaze_off", baseline_version: 1, outcome_status: "open", before_value: 4 }]);
  const update = t.mock.method(model, "updateTipOutcome", async () => {});
  const result = await service.evaluateOpenTips(1);
  assert.equal(result[0].outcome_status, "improved");
  assert.equal(update.mock.calls[0].arguments[0].afterValue, 1);
});

test("small question-type samples are not labelled weakest", async (t) => {
  fixture(t, [0.8, 0.8], [30, 30]);
  assert.equal((await service.perTypeAnalysis(1)).weakest_type, null);
});

test("delivery tips wait when the baseline version changes", async (t) => {
  fixture(t, [0.1, 0.4]);
  t.mock.method(model, "getTipsForUser", async () => [{ id: 1, session_id: 1, metric: "gaze_off", baseline_version: 2, outcome_status: "open", before_value: 4 }]);
  assert.deepEqual(await service.evaluateOpenTips(1), []);
});

test("baseline refresh rejects an inaccessible session rather than falling back", async (t) => {
  t.mock.method(model, "getSessionForUser", async () => null);
  assert.equal((await service.buildBaselineForSession(1, 999)).status, "insufficient data");
});

test("text lengths alone cannot form a delivery baseline", async (t) => {
  t.mock.method(model, "getSessionForUser", async () => ({ id: 1 }));
  t.mock.method(model, "getSignalsForSession", async () => [1, 2, 3].map(() => ({ metrics: { browser_word_count: 20 } })));
  assert.equal((await service.buildBaselineForSession(1, 1)).status, "insufficient data");
});
