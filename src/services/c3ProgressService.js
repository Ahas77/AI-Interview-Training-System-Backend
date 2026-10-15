const C3Model = require("../models/c3Model");
const config = require("../config/c3Config");
const {
  buildBaselineMetrics,
  summarizeQuestions,
  averageQuestionSummaries,
  mean,
  round,
  classifyDrift,
  spearmanCorrelation,
} = require("./c3AnalyticsService");
const { buildFindings, generateTipText, evaluateOutcome, driftExplanation } = require("./c3CoachingService");

async function getSessionSummary(sessionId, userId) {
  const session = await C3Model.getSessionForUser(sessionId, userId);
  if (!session) return null;

  const baseline = await C3Model.getLatestBaseline(userId);
  const qaLogs = await C3Model.getQALogsForSession(sessionId);
  const signals = await C3Model.getSignalsForSession(sessionId);
  const summaries = summarizeQuestions({ qaLogs, signals, baseline });
  return { session, baseline, summaries, aggregate: averageQuestionSummaries(summaries) };
}

async function getAllSessionSummaries(userId) {
  const sessions = await C3Model.getInterviewSessionsForUser(userId);
  const results = [];
  for (const session of sessions) {
    const summary = await getSessionSummary(session.id, userId);
    if (summary) results.push(summary);
  }
  return results;
}

async function buildBaselineForSession(userId, sessionId) {
  let session = sessionId ? await C3Model.getSessionForUser(sessionId, userId) : null;
  let source = "warmup";
  let signals = [];

  if (session) {
    signals = await C3Model.getSignalsForSession(session.id);
  } else {
    if (sessionId) return { status: "insufficient data", message: "Session not found or access denied." };
    const sessions = (await C3Model.getInterviewSessionsForUser(userId)).slice(-2);
    if (!sessions.length) return { status: "insufficient data", message: "No warm-up or interview signals available." };
    signals = await C3Model.getSignalsForSessions(sessions.map((item) => item.id));
    source = "recent_sessions";
    session = null;
  }

  if (!signals.length) {
    return { status: "insufficient data", message: "No signal readings found for baseline." };
  }

  const baseline = buildBaselineMetrics(signals);
  baseline.metrics = Object.fromEntries(Object.entries(baseline.metrics)
    .filter(([, data]) => data.n >= config.MIN_SIGNAL_READINGS_PER_METRIC));
  if (!Object.keys(baseline.metrics).length) {
    return { status: "insufficient data", message: "Record at least 3 valid readings per delivery indicator. Text length alone cannot create a delivery baseline." };
  }
  baseline.confidence = round(Math.min(1, Math.min(...Object.values(baseline.metrics).map((metric) => metric.n)) / config.BASELINE_CONFIDENCE_TARGET_READINGS));

  const saved = await C3Model.saveBaseline({
    userId,
    sessionId: session?.id || null,
    metrics: baseline.metrics,
    confidence: baseline.confidence,
    source,
  });

  return { status: "ready", baseline: saved };
}

async function progressOverview(userId) {
  const baseline = await C3Model.getLatestBaseline(userId);
  const all = await getAllSessionSummaries(userId);
  if (!all.length) return { status: "insufficient data", message: "No interview sessions found." };

  return {
    status: "ready",
    baseline,
    sessions: all.map(({ session, aggregate }) => ({
      session_id: session.id,
      session_number: session.session_number,
      date: session.created_at,
      ...aggregate,
    })),
  };
}

async function perTypeAnalysis(userId) {
  const all = await getAllSessionSummaries(userId);
  const summaries = all.flatMap((item) => item.summaries);
  if (!summaries.length) return { status: "insufficient data", message: "No answered questions found." };

  const overall = averageQuestionSummaries(summaries);
  const groups = {};
  summaries.forEach((summary) => {
    const type = summary.question_type || "hr";
    if (!groups[type]) groups[type] = [];
    groups[type].push(summary);
  });

  const analysis = Object.entries(groups).map(([questionType, items]) => {
    const agg = averageQuestionSummaries(items);
    const trend = all.map(({ session, summaries: sessionSummaries }) => ({
      session_id: session.id,
      session_number: session.session_number,
      ...averageQuestionSummaries(sessionSummaries.filter((item) => item.question_type === questionType)),
    }));
    return {
      question_type: questionType,
      status: items.length < 3 ? "insufficient data" : "ready",
      count: items.length,
      average_score: agg.average_answer_score,
      average_delivery_deviation: agg.average_delivery_deviation,
      average_metrics: agg.average_metrics,
      difference_from_overall_delivery_deviation:
        agg.average_delivery_deviation == null || overall.average_delivery_deviation == null
          ? null
          : round(agg.average_delivery_deviation - overall.average_delivery_deviation),
      trend,
    };
  });

  const readyTypes = analysis.filter((item) => item.status === "ready" && item.average_score != null);
  const weakest = readyTypes.sort((a, b) => a.average_score - b.average_score)[0] || null;
  return { status: "ready", overall, weakest_type: weakest?.question_type || null, analysis };
}

async function progressComparison(userId) {
  const all = await getAllSessionSummaries(userId);
  if (all.length < 2) return { status: "insufficient data", message: "At least 2 interview sessions are required." };

  // Disjoint windows prevent two sessions from being compared with themselves.
  const windowSize = Math.min(2, Math.floor(all.length / 2));
  const first = all.slice(0, windowSize);
  const latest = all.slice(-windowSize);
  const firstAgg = averageQuestionSummaries(first.flatMap((item) => item.summaries));
  const latestAgg = averageQuestionSummaries(latest.flatMap((item) => item.summaries));
  const metricNames = new Set([
    ...Object.keys(firstAgg.average_metrics || {}),
    ...Object.keys(latestAgg.average_metrics || {}),
  ]);
  let closerCount = 0;
  let comparableCount = 0;
  const baselineMetrics = all[0].baseline?.metrics || {};

  metricNames.forEach((metric) => {
    const center = baselineMetrics[metric]?.mean;
    const beforeValue = firstAgg.average_metrics[metric];
    const afterValue = latestAgg.average_metrics[metric];
    if (center == null || beforeValue == null || afterValue == null) return;
    const before = Math.abs(beforeValue - center);
    const after = Math.abs(afterValue - center);
    comparableCount++;
    if (after <= before) closerCount++;
  });

  const ratings = await C3Model.getSelfRatings(userId);
  const latestRating = ratings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;

  return {
    status: "ready",
    fixed_threshold_progress: {
      raw_average_answer_score_change:
        firstAgg.average_answer_score == null || latestAgg.average_answer_score == null
          ? null
          : round(latestAgg.average_answer_score - firstAgg.average_answer_score),
      note: firstAgg.average_answer_score == null || latestAgg.average_answer_score == null ? "answer_score unavailable" : null,
    },
    baseline_relative_progress: {
      delivery_deviation_change:
        firstAgg.average_delivery_deviation == null || latestAgg.average_delivery_deviation == null
          ? null
          : round(firstAgg.average_delivery_deviation - latestAgg.average_delivery_deviation),
      share_metrics_moved_closer_to_baseline: comparableCount ? round(closerCount / comparableCount) : null,
    },
    latest_self_rating: latestRating,
  };
}

async function detectDrift(userId) {
  const all = await getAllSessionSummaries(userId);
  if (all.length < config.MIN_DRIFT_SESSIONS) {
    return { status: "insufficient data", message: `At least ${config.MIN_DRIFT_SESSIONS} sessions are required before drift detection.` };
  }

  const reference = all.slice(0, Math.min(config.REFERENCE_DRIFT_SESSION_COUNT, all.length - config.RECENT_DRIFT_SESSION_COUNT));
  const recent = all.slice(-config.RECENT_DRIFT_SESSION_COUNT);
  const refAgg = averageQuestionSummaries(reference.flatMap((item) => item.summaries));
  const recentAgg = averageQuestionSummaries(recent.flatMap((item) => item.summaries));
  const metrics = Object.keys(recentAgg.average_metrics || {});
  const scoreAvailable = refAgg.average_answer_score != null && recentAgg.average_answer_score != null;
  const scoreChange = scoreAvailable ? recentAgg.average_answer_score - refAgg.average_answer_score : null;

  const events = [];
  metrics.forEach((metric) => {
    const refValues = reference.map((item) => item.aggregate.average_metrics[metric]).filter((x) => x != null);
    const recentValue = recentAgg.average_metrics[metric];
    const recentValues = recent.map((item) => item.aggregate.average_metrics[metric]);
    if (refValues.length < 2 || recentValues.some((value) => value == null) || recentValue == null) return;
    const refMean = mean(refValues);
    const refStd = Math.max(
      Math.sqrt(refValues.reduce((sum, value) => sum + Math.pow(value - refMean, 2), 0) / refValues.length),
      config.BASELINE_STD_FLOOR
    );
    const z = round((recentValue - refMean) / refStd);
    if (Math.abs(z) < config.DRIFT_Z_THRESHOLD) return;
    // Both recent sessions must cross the threshold in the same direction.
    if (!recentValues.every((value) => Math.sign(value - refMean) === Math.sign(z) &&
      Math.abs((value - refMean) / refStd) >= config.DRIFT_Z_THRESHOLD)) return;
    const baseline = all[0].baseline?.metrics?.[metric];
    const deviationChange = baseline ? Math.abs(recentValue - baseline.mean) - Math.abs(refMean - baseline.mean) : null;
    const event = {
      user_id: userId,
      metric,
      question_type: null,
      z_score: z,
      direction: z >= 0 ? "up" : "down",
      classification: deviationChange == null ? "behaviour_shift" : classifyDrift({ deviationChange, scoreChange, scoreAvailable }),
      detected_at_session_number: recent[recent.length - 1].session.session_number,
    };
    event.explanation = driftExplanation(event, scoreAvailable);
    event.baseline_refresh_suggested = Math.abs(z) >= config.DRIFT_Z_THRESHOLD * 2;
    events.push(event);
  });

  for (const event of events) {
    await C3Model.insertDriftEvent(event);
  }

  return { status: "ready", events };
}

async function generateCoaching(userId, sessionId) {
  const summary = await getSessionSummary(sessionId, userId);
  if (!summary) return null;
  const all = (await getAllSessionSummaries(userId)).filter((item) =>
    Number(item.session.session_number) <= Number(summary.session.session_number));
  const findings = buildFindings({
    summaries: summary.summaries,
    allSessionSummaries: all.map((item) => item.summaries),
    driftEvents: [],
  });

  if (!findings.length) {
    return { status: "insufficient data", message: "No coaching findings met the configured thresholds." };
  }

  const existingTips = await C3Model.getTipsForUser(userId);
  const savedTips = existingTips.filter((tip) => Number(tip.session_id) === Number(sessionId));
  if (savedTips.length) return { status: "ready", tips: savedTips };
  const tips = [];
  for (const finding of findings) {
    const failedFollowed = existingTips.find(
      (tip) => tip.metric === finding.metric && tip.followed === "yes" && tip.outcome_status === "no_change"
    );
    const notFollowed = existingTips.find((tip) => tip.metric === finding.metric && tip.followed === "no");
    const text = await generateTipText(finding, Boolean(notFollowed));
    if (failedFollowed && text.approach_label === failedFollowed.approach_label) {
      text.approach_label = `${text.approach_label}_alternate`;
    }
    const tip = {
      user_id: userId,
      session_id: sessionId,
      qa_id: finding.qa_id,
      question_type: finding.question_type,
      metric: finding.metric,
      before_value: finding.metric === "answer_score" ? finding.before_value : Math.abs(finding.deviation),
      goal_text: finding.metric === "answer_score" ? "Improve answer content using the same rubric." : `Reduce distance of ${finding.metric} from your personal baseline.`,
      tip: text.tip,
      why: finding.evidence,
      practice: text.practice,
      approach_label: text.approach_label,
      evidence: finding.evidence,
      baseline_version: summary.baseline?.version || null,
    };
    tip.id = await C3Model.insertCoachingTip(tip);
    tip.outcome_status = "open";
    tips.push(tip);
  }

  return { status: "ready", tips };
}

async function evaluateOpenTips(userId) {
  const tips = (await C3Model.getTipsForUser(userId)).filter((tip) => tip.outcome_status === "open");
  const all = await getAllSessionSummaries(userId);
  const results = [];

  for (const tip of tips) {
    const origin = all.find((item) => Number(item.session.id) === Number(tip.session_id));
    if (!origin) continue;
    if (tip.metric !== "answer_score" && (!tip.baseline_version || Number(tip.baseline_version) !== Number(origin.baseline?.version))) continue;
    const later = all
      .filter((item) => Number(item.session.session_number) > Number(origin.session.session_number))
      .slice(0, 2);
    const matching = later.flatMap((item) =>
      item.summaries.filter((summary) => !tip.question_type || summary.question_type === tip.question_type)
    );
    const values = matching
      .map((summary) => tip.metric === "answer_score" ? summary.answer_score :
        tip.metric === "delivery_deviation" ? summary.delivery_deviation :
          summary.metrics?.[tip.metric]?.deviation == null ? null : Math.abs(summary.metrics[tip.metric].deviation))
      .filter((value) => value != null);
    if (!values.length) continue;
    const afterValue = round(mean(values));
    const outcomeStatus = tip.metric === "answer_score" ? evaluateOutcome(afterValue, Number(tip.before_value)) :
      evaluateOutcome(Number(tip.before_value), afterValue);
    await C3Model.updateTipOutcome({ tipId: tip.id, userId, afterValue, outcomeStatus });
    results.push({ tip_id: tip.id, after_value: afterValue, outcome_status: outcomeStatus });
  }

  return results;
}

async function evaluationRows(includeDemo = false) {
  const userIds = await C3Model.getEvaluationUsers(includeDemo);
  const rows = [];
  for (const userId of userIds) {
    const all = await getAllSessionSummaries(userId);
    const ratings = await C3Model.getSelfRatings(userId);
    const tips = await C3Model.getTipsForUser(userId);
    all.forEach((item, index) => {
      const first = all[0].aggregate;
      const rating = ratings.find((r) => Number(r.session_id) === Number(item.session.id));
      const sessionTips = tips.filter((tip) => Number(tip.session_id) === Number(item.session.id));
      rows.push({
        user_id: userId,
        session_id: item.session.id,
        session_number: item.session.session_number,
        fixed_threshold_progress: index === 0 || first.average_answer_score == null || item.aggregate.average_answer_score == null ? null : round(item.aggregate.average_answer_score - first.average_answer_score),
        baseline_relative_progress: index === 0 || first.average_delivery_deviation == null || item.aggregate.average_delivery_deviation == null ? null : round(first.average_delivery_deviation - item.aggregate.average_delivery_deviation),
        delivery_deviation: item.aggregate.average_delivery_deviation,
        average_score: item.aggregate.average_answer_score,
        self_rated_improvement: rating?.improvement_rating ?? null,
        tips_given: sessionTips.length,
        tips_followed: sessionTips.filter((tip) => tip.followed === "yes").length,
        tip_outcomes: sessionTips.map((tip) => tip.outcome_status).join("|"),
      });
    });
  }
  return rows;
}

async function correlationSummary(includeDemo = false) {
  // One latest rated observation per participant avoids counting repeated sessions as independent people.
  const latestByUser = new Map();
  for (const row of await evaluationRows(includeDemo)) {
    if (row.self_rated_improvement != null && (row.fixed_threshold_progress != null || row.baseline_relative_progress != null)) latestByUser.set(row.user_id, row);
  }
  const rows = [...latestByUser.values()];
  const participantCount = new Set(rows.map((row) => row.user_id)).size;
  if (participantCount < 5) {
    return { status: "insufficient data", message: "At least 5 participants are required.", participant_count: participantCount };
  }
  return {
    status: "ready",
    participant_count: participantCount,
    fixed_threshold_spearman: spearmanCorrelation(
      rows.filter((row) => row.fixed_threshold_progress != null).map((row) => ({ x: Number(row.fixed_threshold_progress), y: Number(row.self_rated_improvement) }))
    ),
    baseline_relative_spearman: spearmanCorrelation(
      rows.filter((row) => row.baseline_relative_progress != null).map((row) => ({ x: Number(row.baseline_relative_progress), y: Number(row.self_rated_improvement) }))
    ),
  };
}

module.exports = {
  getSessionSummary,
  getAllSessionSummaries,
  buildBaselineForSession,
  progressOverview,
  perTypeAnalysis,
  progressComparison,
  detectDrift,
  generateCoaching,
  evaluateOpenTips,
  evaluationRows,
  correlationSummary,
};
