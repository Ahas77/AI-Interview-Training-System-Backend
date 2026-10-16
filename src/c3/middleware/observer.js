const routes = require("../config/observedRoutes");
const limits = require("../config/thresholds");
const { wordCount } = require("../services/analytics");

function at(object, paths = []) {
  for (const path of Array.isArray(paths) ? paths : [paths]) {
    const keys = String(path).split(".");
    if (keys.some((key) => /password|token|authorization|image|raw_response/i.test(key))) continue;
    let value = object;
    for (const key of keys) { value = value && Object.hasOwn(value, key) ? value[key] : undefined; }
    if (value != null) return value;
  }
  return undefined;
}
function positiveId(value) { return /^(?:[1-9]\d*)$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null; }
function label(value, max = 80) { return typeof value === "string" && /^[a-zA-Z0-9_. /-]+$/.test(value) ? value.slice(0, max) : null; }

function snapshot(route, req, body, receivedAt, match) {
  if (body?.success === false) return null;
  const envelope = { request: { body: req.body || {} }, response: body || {} };
  const fields = route.fields || {};
  const question = at(envelope, fields.question);
  const userId = positiveId(req.user?.id);
  const sessionId = positiveId(at(envelope, fields.session)) || positiveId(match?.[1]);
  if (!userId || !sessionId) return null;
  const data = {
    handler: route.handler, userId, sessionId, qaId: positiveId(at(envelope, fields.qa)),
    receivedAt, deliveredAt: new Date(), questionId: positiveId(question?.id),
    questionType: label(at(envelope, fields.questionType), 50),
    words: wordCount(req.body?.userAnswerText), complete: body?.isCompleted === true,
  };
  if (route.handler === "faceSignals") {
    data.metrics = Object.create(null);
    for (const [metric, paths] of Object.entries(fields.metrics || {}).slice(0, limits.MAX_METRICS)) {
      const value = at(envelope, paths);
      if (/^[a-z][a-z0-9_]*$/i.test(metric) && !/password|token|authorization|image/i.test(metric) && metric.length <= limits.MAX_METRIC_NAME && typeof value === "number" && Number.isFinite(value)) data.metrics[metric] = value;
    }
    const time = at(envelope, fields.timestamp);
    data.t_sec = typeof time === "number" && Number.isFinite(time) && time >= 0 ? time : null;
    data.model_name = label(at(envelope, fields.model));
    data.model_version = label(at(envelope, fields.version));
    const confidence = at(envelope, fields.confidence);
    data.confidence = typeof confidence === "number" && confidence >= 0 && confidence <= 1 ? confidence : null;
  }
  if (route.handler === "answerScore") {
    const score = at(envelope, fields.score);
    data.score = typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 100 ? score : null;
    data.questionType = label(at(envelope, fields.type), 50);
    data.scoreSource = label(fields.scoreSource) || "teammate";
  }
  return JSON.stringify(data).length <= limits.MAX_OBSERVER_BYTES ? data : null;
}

function createObserver({ observedRoutes = [...routes.coreRoutes, ...routes.extraRoutes], dispatch,
  enabled = () => process.env.C3_OBSERVER !== "off" } = {}) {
  const pending = new Set();
  const perSession = new Map();
  let warned = false;
  function middleware(req, res, next) {
    if (!enabled()) return next();
    try {
      const path = (req.originalUrl || req.url || "").split("?")[0];
      const route = observedRoutes.find((item) => item.enabled !== false && item.method === req.method && item.pattern.test(path));
      if (!route) return next();
      const match = path.match(route.pattern);
      const receivedAt = new Date();
      let captured;
      const json = res.json;
      res.json = function (body) {
        try { captured = snapshot(route, req, body, receivedAt, match); } catch (_error) { /* Never affect the real response. */ }
        return json.apply(this, arguments);
      };
      res.once("finish", () => {
        try {
        if (!enabled() || !captured || res.statusCode < 200 || res.statusCode >= 300 || pending.size >= limits.MAX_PENDING_OBSERVATIONS) return;
        // Only the small whitelisted snapshot survives the response, never the request or raw body.
        const data = captured;
        captured = null;
        data.deliveredAt = new Date();
        const key = `${data.userId}:${data.sessionId}`;
        const previous = perSession.get(key) || Promise.resolve();
        const job = previous.then(() => new Promise((resolve) => setImmediate(resolve))).then(() =>
          (dispatch || require("../services/observationHandlers").dispatch)(data)).catch(() => {
          if (!warned) { warned = true; console.warn("C3 observer skipped an observation; interview response was unaffected."); }
        });
        pending.add(job); perSession.set(key, job);
        void job.finally(() => { pending.delete(job); if (perSession.get(key) === job) perSession.delete(key); });
        } catch (_error) { /* Even unexpected finish-listener errors are isolated. */ }
      });
    } catch (_error) { /* Middleware setup failures also pass through. */ }
    return next();
  }
  middleware.drain = async () => { while (pending.size) await Promise.all([...pending]); };
  return middleware;
}
module.exports = createObserver();
module.exports.createObserver = createObserver;
module.exports.snapshot = snapshot;
