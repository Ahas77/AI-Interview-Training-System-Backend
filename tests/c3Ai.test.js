const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
const ai = require("../src/services/c3AiService");

function mockResponse(t, value) {
  t.mock.method(axios, "post", async () => ({ data: { output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }] } }));
  const previous = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = "test-key-never-sent";
  t.after(() => { if (previous === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = previous; });
}

test("answer scoring sums a validated rubric and retains grounded feedback", async (t) => {
  mockResponse(t, { question_type: "technical", rubric: { relevance: 20, correctness: 15, evidence: 10, clarity: 20 }, feedback: "Explain the index tradeoff." });
  const result = await ai.evaluateAnswer("What is an SQL index?", "A lookup structure");
  assert.equal(result.score, 65);
  assert.equal(result.questionType, "technical");
  assert.equal(axios.post.mock.calls[0].arguments[1].store, false);
});

test("invalid rubric values never become saved scores", async (t) => {
  mockResponse(t, { rubric: { relevance: 1000, correctness: 25, evidence: 25, clarity: 25 }, feedback: "Invalid" });
  await assert.rejects(ai.evaluateAnswer("Question", "Answer"), /Invalid answer rubric/);
});

test("no visible face produces no fabricated readings", async (t) => {
  mockResponse(t, { face_visible: false });
  assert.equal(await ai.analyzeFrame("data:image/jpeg;base64,abc"), null);
});

test("vision accepts only bounded numeric visual indicators", async (t) => {
  mockResponse(t, { face_visible: true, gaze_off: "0.5", head_turn: 0.2 });
  await assert.rejects(ai.analyzeFrame("data:image/jpeg;base64,abc"), /Invalid image indicators/);
});

test("question categories work even without Grok", () => {
  assert.equal(ai.classifyQuestion("Describe a time you resolved a conflict"), "behavioral");
  assert.equal(ai.classifyQuestion("How would you manage a late delivery?"), "situational");
  assert.equal(ai.classifyQuestion("Explain SQL indexes"), "technical");
  assert.equal(ai.classifyQuestion("Tell me about yourself"), "hr");
});
