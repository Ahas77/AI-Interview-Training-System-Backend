// Field paths use the whitelisted snapshot envelope: request.body / response.
// Paths are exact regular expressions; no substring matching against unrelated routes.
const fields = {
  session: ["request.body.sessionId", "response.sessionId", "response.data.sessionId", "response.session.id"],
  qa: ["request.body.qaId", "response.qaId", "response.data.qaId"],
  question: ["response.currentQuestion", "response.data.currentQuestion"],
  questionType: ["response.currentQuestion.question_type", "response.currentQuestion.questionType"],
};
const coreRoutes = [
  { method: "POST", pattern: /^\/api\/interview\/start\/?$/, handler: "start", fields: { ...fields, session: ["response.sessionId", "response.data.sessionId"] } },
  { method: "POST", pattern: /^\/api\/interview\/submit-answer\/?$/, handler: "answer", fields },
  { method: "POST", pattern: /^\/api\/interview\/complete\/?$/, handler: "complete", fields },
  { method: "GET", pattern: /^\/api\/interview\/session\/(\d+)\/?$/, handler: "session", fields },
];
// PLACEHOLDERS ONLY: replace pattern and field paths when real endpoints exist.
// Disabled placeholders never intercept traffic. Metrics are an explicit allowlist.
const extraRoutes = [
  { enabled: false, method: "POST", pattern: /^\/api\/REPLACE_FACE_ROUTE$/, handler: "faceSignals",
    fields: { ...fields, timestamp: ["response.data.t_sec", "request.body.t_sec"],
      metrics: { gaze_off: ["response.data.metrics.gaze_off"], head_turn: ["response.data.metrics.head_turn"] },
      model: ["response.data.model_name"], version: ["response.data.model_version"], confidence: ["response.data.confidence"] } },
  { enabled: false, method: "POST", pattern: /^\/api\/REPLACE_SCORE_ROUTE$/, handler: "answerScore",
    fields: { ...fields, score: ["response.data.score"], type: ["response.data.question_type"], scoreSource: "teammate" } },
];
module.exports = { coreRoutes, extraRoutes };
