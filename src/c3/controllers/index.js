const store = require("../models/store");
const progress = require("../services/progress");
const limits = require("../config/thresholds");
const { toCsv } = require("../services/privacy");

function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function id(value, allowWarmup = false) {
  if (!/^-?[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || (!allowWarmup && Number(value) < 0)) fail(400, "Invalid identifier.");
  return Number(value);
}
async function owned(req, sessionId) {
  const session = await store.getSessionForUser(sessionId, req.user.id);
  if (!session) fail(404, "Session not found or access denied.");
  return session;
}
function endpoint(fn, status = 200) {
  return async (req, res) => {
    try {
      const data = await fn(req, res);
      if (!res.headersSent) res.status(status).json({ success: true, message: "C3 request completed.", data });
    } catch (error) {
      if (!res.headersSent) res.status(error.status || 503).json({ success: false, message: error.status ? error.message : "C3 is temporarily unavailable; interview endpoints are unaffected.", data: null });
    }
  };
}
function ready(result) { if (result.status !== "ready") fail(422, result.message || "Insufficient data."); return result; }
function rating(value, optional = false) {
  if (optional && value == null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) fail(422, "Ratings must be integers from 1 to 5.");
  return value;
}
function validMetrics(metrics) {
  return metrics && typeof metrics === "object" && !Array.isArray(metrics) &&
    Object.keys(metrics).length > 0 && Object.keys(metrics).length <= limits.MAX_METRICS &&
    Object.entries(metrics).every(([key, value]) => /^[a-z][a-z0-9_]*$/i.test(key) && !/password|token|authorization|image/i.test(key) && key.length <= limits.MAX_METRIC_NAME && typeof value === "number" && Number.isFinite(value));
}
const controller = {
  ingestSignals: endpoint(async (req) => {
    const { readings, qaId } = req.body || {};
    const sessionId = id(req.body?.sessionId, true);
    if (!Array.isArray(readings)) fail(400, "readings array is required.");
    if (!readings.length || readings.length > limits.MAX_SIGNAL_BATCH_SIZE) fail(422, `Provide 1-${limits.MAX_SIGNAL_BATCH_SIZE} readings.`);
    await owned(req, sessionId);
    let questionId = null;
    if (qaId != null) {
      questionId = id(qaId);
      if (sessionId < 0 || !(await store.reader.questions(sessionId)).some((q) => q.id === questionId)) fail(404, "Question not found in this session.");
    }
    const cleaned = readings.map((reading) => {
      if (!reading || typeof reading.t_sec !== "number" || !Number.isFinite(reading.t_sec) || reading.t_sec < 0 ||
        !["face", "voice", "text"].includes(reading.source) || !validMetrics(reading.metrics)) fail(422, "Each reading needs a nonnegative timestamp, face/voice/text source and numeric metrics.");
      if (reading.confidence != null && (typeof reading.confidence !== "number" || !Number.isFinite(reading.confidence) || reading.confidence < 0 || reading.confidence > 1)) fail(422, "confidence must be between 0 and 1.");
      const model = (value) => value == null ? null : typeof value === "string" && /^[a-zA-Z0-9_. /-]{1,80}$/.test(value) ? value : fail(422, "Invalid model label.");
      return { t_sec: reading.t_sec, source: reading.source, metrics: reading.metrics,
        model_name: model(reading.model_name), model_version: model(reading.model_version), confidence: reading.confidence ?? null };
    });
    return { inserted: await store.insertSignals(sessionId, questionId, cleaned) };
  }, 201),
  warmup: endpoint(async (req) => {
    if (req.body?.sessionId != null) fail(422, "Warm-ups use separate C3 records; existing interviews cannot be converted.");
    return { sessionId: await store.createWarmupSession({ userId: req.user.id }) };
  }, 201),
  baseline: endpoint(async (req) => {
    const sessionId = req.body?.sessionId == null ? null : id(req.body.sessionId, true);
    if (sessionId != null) { const session = await owned(req, sessionId); if (session.session_type !== "warmup") fail(422, "Use a C3 warm-up, or omit sessionId for the flagged first-two-interviews fallback."); }
    return ready(await progress.buildBaselineForSession(req.user.id, sessionId));
  }, 201),
  refresh: endpoint(async (req) => {
    if (req.body?.confirmed !== true) fail(422, "Explicit confirmation is required: send confirmed: true.");
    const sessionId = req.body.sessionId == null ? null : id(req.body.sessionId, true);
    if (sessionId != null && (await owned(req, sessionId)).status !== "completed") fail(422, "Use a warm-up or a completed interview for refresh.");
    return ready(await progress.buildBaselineForSession(req.user.id, sessionId, true));
  }, 201),
  overview: endpoint((req) => progress.progressOverview(req.user.id)),
  perType: endpoint((req) => progress.perTypeAnalysis(req.user.id)),
  comparison: endpoint((req) => progress.progressComparison(req.user.id)),
  drift: endpoint((req) => progress.detectDrift(req.user.id)),
  session: endpoint(async (req) => {
    const sessionId = id(req.params.sessionId);
    await owned(req, sessionId);
    const summary = await progress.getSessionSummary(sessionId, req.user.id);
    return { ...summary, coaching_tips: await store.getTipsForUser(req.user.id, sessionId) };
  }),
  questions: endpoint(async (req) => {
    const sessionId = id(req.params.sessionId); await owned(req, sessionId);
    return (await progress.getSessionSummary(sessionId, req.user.id)).summaries;
  }),
  findings: endpoint(async (req) => {
    const sessionId = id(req.params.sessionId); await owned(req, sessionId);
    return require("../services/coaching").buildFindings({ summaries: (await progress.getSessionSummary(sessionId, req.user.id)).summaries });
  }),
  coaching: endpoint(async (req) => {
    const sessionId = id(req.params.sessionId); const session = await owned(req, sessionId);
    if (session.status !== "completed") fail(422, "Complete the interview before generating coaching.");
    return await progress.generateCoaching(req.user.id, sessionId);
  }, 201),
  tips: endpoint(async (req) => {
    const sessionId = req.query.sessionId == null ? null : id(req.query.sessionId);
    if (sessionId) await owned(req, sessionId);
    return store.getTipsForUser(req.user.id, sessionId);
  }),
  followed: endpoint(async (req) => {
    const tipId = id(req.params.tipId), followed = req.body?.followed;
    if (!["yes", "partly", "no"].includes(followed)) fail(422, "followed must be yes, partly or no.");
    if (!await store.patchTipFollowed(tipId, req.user.id, followed)) fail(404, "Tip not found or access denied.");
    return { tipId, followed };
  }),
  evaluate: endpoint((req) => progress.evaluateOpenTips(req.user.id)),
  outcomes: endpoint((req) => store.getTipsForUser(req.user.id)),
  selfRating: endpoint(async (req) => {
    const body = req.body || {}, sessionId = id(body.sessionId); await owned(req, sessionId);
    if (body.comment != null && (typeof body.comment !== "string" || body.comment.length > limits.MAX_COMMENT_LENGTH)) fail(422, "Invalid comment or comment too long.");
    await store.upsertSelfRating({ userId: req.user.id, sessionId, improvementRating: rating(body.improvementRating),
      tipClarityRating: rating(body.tipClarityRating, true), tipUsefulnessRating: rating(body.tipUsefulnessRating, true), comment: body.comment || null });
    return { sessionId };
  }),
  dataset: endpoint((req) => progress.evaluationRows(req.query.includeDemo === "true")),
  correlation: endpoint((req) => progress.correlationSummary(req.query.includeDemo === "true")),
  csv: endpoint(async (req, res) => {
    const rows = await progress.evaluationRows(req.query.includeDemo === "true");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="c3-evaluation.csv"');
    res.send(toCsv(rows));
  }),
  refreshMetadata: endpoint(async (req) => {
    const sessionId = id(req.params.sessionId); await owned(req, sessionId);
    await require("../services/observationHandlers").backfillSession(sessionId, req.user.id);
    return { analyzed: (await store.reader.questions(sessionId)).length, note: "Existing component results imported; missing scores are not invented." };
  }),
  retired: endpoint(() => fail(422, "The sidecar observes existing component outputs. Configure observedRoutes.js or send numeric readings to /signals; C3 does not upload images or independently score answers.")),
};
module.exports = { controller, validMetrics, id };
