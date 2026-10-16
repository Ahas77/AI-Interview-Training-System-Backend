const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildBaselineMetrics,
  summarizeQuestions,
  classifyDrift,
  spearmanCorrelation,
} = require("../services/analytics");
const { buildFindings, evaluateOutcome } = require("../services/coaching");

test("buildBaselineMetrics computes mean, floored std, count, and confidence", () => {
  const baseline = buildBaselineMetrics([
    { metrics: { tension: 0.2, gaze_off: 0.4 } },
    { metrics: { tension: 0.4, gaze_off: 0.6 } },
  ]);

  assert.equal(baseline.metrics.tension.n, 2);
  assert.equal(baseline.metrics.tension.mean, 0.3);
  assert.ok(baseline.metrics.tension.std >= 0.05);
  assert.equal(baseline.confidence, 0.2);
});

test("summarizeQuestions computes baseline-relative delivery deviation", () => {
  const summaries = summarizeQuestions({
    baseline: {
      metrics: {
        tension: { mean: 0.2, std: 0.1, n: 10 },
      },
    },
    qaLogs: [
      {
        id: 1,
        question_number: 1,
        question_type: "hr",
        question_text: "Tell me about yourself",
        user_answer_text: "Answer text",
        answer_score: 70,
        answer_word_count: 2,
        response_latency_sec: 20,
        question_start_sec: 0,
        answer_end_sec: 10,
      },
    ],
    signals: [
      { qa_id: 1, t_sec: 1, metrics: { tension: 0.4 } },
      { qa_id: 1, t_sec: 2, metrics: { tension: 0.5 } },
      { qa_id: 1, t_sec: 3, metrics: { tension: 0.6 } },
    ],
  });

  assert.equal(summaries[0].metrics.tension.mean, 0.5);
  assert.equal(summaries[0].metrics.tension.deviation, 3);
  assert.equal(summaries[0].delivery_deviation, 3);
});

test("classifyDrift separates improvement, decline, and behaviour shift", () => {
  assert.equal(classifyDrift({ deviationChange: -0.2, scoreChange: 0, scoreAvailable: true }), "improvement");
  assert.equal(classifyDrift({ deviationChange: 0.2, scoreChange: -1, scoreAvailable: true }), "decline");
  assert.equal(classifyDrift({ deviationChange: 0.2, scoreChange: null, scoreAvailable: false }), "behaviour_shift");
  assert.equal(classifyDrift({ deviationChange: -0.2, scoreChange: null, scoreAvailable: false }), "behaviour_shift");
});

test("buildFindings emits ranked findings for high deviations", () => {
  const findings = buildFindings({
    summaries: [
      {
        qa_id: 10,
        question_type: "technical",
        answer_score: 50,
        metrics: {
          gaze_off: {
            status: "ok",
            mean: 0.8,
            baseline_mean: 0.3,
            deviation: 5,
            peak_t_sec: 12,
          },
        },
      },
    ],
  });

  assert.equal(findings.length, 2);
  assert.ok(findings.some((finding) => finding.metric === "gaze_off"));
  assert.match(findings.find((finding) => finding.metric === "gaze_off").evidence, /baseline/);
});

test("evaluateOutcome compares before and after with margin", () => {
  assert.equal(evaluateOutcome(0.8, 0.6), "improved");
  assert.equal(evaluateOutcome(0.8, 0.81), "no_change");
  assert.equal(evaluateOutcome(0.8, 0.9), "worse");
});

test("spearmanCorrelation returns positive rank relationship", () => {
  const corr = spearmanCorrelation([
    { x: 1, y: 1 },
    { x: 2, y: 3 },
    { x: 3, y: 4 },
  ]);
  assert.equal(corr, 1);
});
