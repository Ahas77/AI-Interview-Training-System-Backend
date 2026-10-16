const test = require("node:test");
const assert = require("node:assert/strict");
const provider = require("../../services/ai/aiProvider");
const { generateTipText, buildFindings } = require("../services/coaching");
const finding = { metric: "gaze_off", evidence: "Mean 0.6 vs baseline 0.2; delivery deviation 4.", before_value: 0.6, deviation: 4 };

test("coaching uses the existing provider and preserves measured evidence", async (t) => {
  const call = t.mock.method(provider, "generateJSON", async () => JSON.stringify({ tip: "Keep your notes near the camera.", why: "Invented explanation", practice: "Rehearse a short answer.", approach_label: "rehearse" }));
  const result = await generateTipText(finding);
  assert.equal(result.why, finding.evidence);
  assert.equal(call.mock.calls.length, 1);
  assert.match(call.mock.calls[0].arguments[1], /gaze_off/);
  assert.doesNotMatch(call.mock.calls[0].arguments[1], /Authorization|password|userAnswerText/);
});

test("invalid JSON receives a shorter practical fallback when a tip was not followed", async (t) => {
  t.mock.method(provider, "generateJSON", async () => "invalid JSON");
  const result = await generateTipText(finding, true);
  assert.match(result.practice, /2 minutes/);
  assert.equal(result.why, finding.evidence);
});

test("a tried but ineffective tip gets a different exercise", async (t) => {
  t.mock.method(provider, "generateJSON", async () => { throw new Error("offline"); });
  const result = await generateTipText(finding, false, true);
  assert.equal(result.approach_label, "outline_then_rehearse");
  assert.match(result.practice, /bullet points/);
});

test("findings deduplicate repeated indicator/type evidence and cap tips at three", () => {
  const summaries = Array.from({ length: 5 }, (_, i) => ({ qa_id: i + 1, question_number: i + 1, question_type: "hr", answer_score: 40,
    metrics: { gaze_off: { status: "ok", mean: 0.9, baseline_mean: 0.2, deviation: 7 } } }));
  const findings = buildFindings({ summaries });
  assert.ok(findings.length <= 3);
  assert.equal(new Set(findings.map((f) => `${f.metric}:${f.question_type}`)).size, findings.length);
});
