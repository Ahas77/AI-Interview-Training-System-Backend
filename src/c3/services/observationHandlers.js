const store = require("../models/store");

async function backfillSession(sessionId, userId) {
  const shared = await store.reader.session(sessionId, userId);
  if (!shared || shared.session_type === "warmup") return false;
  await store.ensureSession(sessionId, userId);
  for (const qa of await store.reader.questions(sessionId)) {
    await store.saveAnswerMeta({ sessionId, qaId: qa.id, questionType: qa.question_type,
      wordCount: qa.user_answer_text == null ? null : require("./analytics").wordCount(qa.user_answer_text),
      score: qa.answer_score == null ? null : Number(qa.answer_score), scoreSource: qa.answer_score == null ? null : "shared_table", preserve: true });
    // Historical answer latency is unknown: do not invent delivery or answer events.
  }
  return true;
}

async function dispatch(data) {
  const { handler, sessionId, userId, qaId } = data;
  const session = await store.reader.session(sessionId, userId);
  if (!session) return;
  if (handler === "session" || handler === "complete") { await backfillSession(sessionId, userId); return; }
  await store.ensureSession(sessionId, userId, data.complete);
  const questions = await store.reader.questions(sessionId);
  const validQuestion = (id) => questions.some((q) => q.id === id);
  if (handler === "start" || handler === "answer") {
    if (handler === "answer" && qaId && validQuestion(qaId)) {
      const logs = await store.getQALogsForSession(sessionId);
      const current = logs.find((q) => q.id === qaId);
      const [events] = await require("../../config/db").pool.query("SELECT occurred_at FROM c3_question_events WHERE session_id = ? AND qa_id = ? AND event = 'question_delivered'", [sessionId, qaId]);
      const delivered = events[0]?.occurred_at || questions.find((q) => q.id === qaId)?.created_at;
      const latency = delivered ? Math.max(0, (data.receivedAt - new Date(delivered)) / 1000) : null;
      await store.recordEvent(sessionId, qaId, "answer_received", data.receivedAt);
      await store.saveAnswerMeta({ sessionId, qaId, wordCount: data.words, latency: current?.response_latency_sec ?? latency });
    }
    if (data.questionId && validQuestion(data.questionId)) {
      await store.recordEvent(sessionId, data.questionId, "question_delivered", data.deliveredAt);
      await store.saveAnswerMeta({ sessionId, qaId: data.questionId, questionType: data.questionType });
    }
  }
  if (handler === "answerScore" && qaId && validQuestion(qaId) && data.score != null) {
    await store.saveAnswerMeta({ sessionId, qaId, score: data.score, scoreSource: data.scoreSource, questionType: data.questionType });
  }
  if (handler === "faceSignals" && Object.keys(data.metrics).length && (!qaId || validQuestion(qaId))) {
    const t_sec = data.t_sec ?? (session.created_at ? Math.max(0, (data.receivedAt - new Date(session.created_at)) / 1000) : null);
    if (t_sec == null) return;
    await store.insertSignals(sessionId, qaId, [{ t_sec, source: "face", metrics: data.metrics,
      model_name: data.model_name, model_version: data.model_version, confidence: data.confidence }]);
  }
}
module.exports = { dispatch, backfillSession };
