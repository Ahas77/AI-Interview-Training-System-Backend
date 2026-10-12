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
    const sessions = (await C3Model.getInterviewSessionsForUser(userId)).slice(0, 2);
    if (!sessions.length) return { status: "insufficient data", message: "No warm-up or interview signals available." };
    signals = await C3Model.getSignalsForSessions(sessions.map((item) => item.id));
    source = "first_sessions";
    session = null;
  }

  if (!signals.length) {
    return { status: "insufficient data", message: "No signal readings found for baseline." };
  }

  const baseline = buildBaselineMetrics(signals);
  if (!Object.keys(baseline.metrics).length) {
    return { status: "insufficient data", message: "No numeric metrics found for baseline." };
  }

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
  if (!baseline) return { status: "insufficient data", message: "No active baseline found." };
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

  const readyTypes = analysis.filter((item) => item.average_delivery_deviation != null);
  const weakest = readyTypes.sort((a, b) => b.average_delivery_deviation - a.average_delivery_deviation)[0] || null;
  return { status: "ready", overall, weakest_type: weakest?.question_type || null, analysis };
}

async function progressComparison(userId) {
  const all = await getAllSessionSummaries(userId);
  if (all.length < 2) return { status: "insufficient data", message: "At least 2 interview sessions are required." };

  const first = all.slice(0, Math.min(2, all.length));
  const latest = all.slice(-Math.min(2, all.length));
  const firstAgg = averageQuestionSummaries(first.flatMap((item) => item.summaries));
  const latestAgg = averageQuestionSummaries(latest.flatMap((item) => item.summaries));
  const metricNames = new Set([
    ...Object.keys(firstAgg.average_metrics || {}),
    ...Object.keys(latestAgg.average_metrics || {}),
  ]);
  let closerCount = 0;
  let comparableCount = 0;

  metricNames.forEach((metric) => {
    const before = Math.abs(firstAgg.average_metrics[metric] || 0);
    const after = Math.abs(latestAgg.average_metrics[metric] || 0);
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

  const reference = all.slice(0, config.REFERENCE_DRIFT_SESSION_COUNT);
  const recent = all.slice(-config.RECENT_DRIFT_SESSION_COUNT);
  const refAgg = averageQuestionSummaries(reference.flatMap((item) => item.summaries));
  const recentAgg = averageQuestionSummaries(recent.flatMap((item) => item.summaries));
  const metrics = Object.keys(recentAgg.average_metrics || {});
  const scoreAvailable = refAgg.average_answer_score != null && recentAgg.average_answer_score != null;
  const scoreChange = scoreAvailable ? recentAgg.average_answer_score - refAgg.average_answer_score : null;
  const deviationChange =
    refAgg.average_delivery_deviation == null || recentAgg.average_delivery_deviation == null
      ? null
      : recentAgg.average_delivery_deviation - refAgg.average_delivery_deviation;

  const events = [];
  metrics.forEach((metric) => {
    const refValues = reference.map((item) => item.aggregate.average_metrics[metric]).filter((x) => x != null);
    const recentValue = recentAgg.average_metrics[metric];
    if (!refValues.length || recentValue == null) return;
    const refMean = mean(refValues);
    const refStd = Math.max(
      Math.sqrt(refValues.reduce((sum, value) => sum + Math.pow(value - refMean, 2), 0) / refValues.length),
      config.BASELINE_STD_FLOOR
    );
    const z = round((recentValue - refMean) / refStd);
    if (Math.abs(z) < config.DRIFT_Z_THRESHOLD) return;
    const event = {
      user_id: userId,
      metric,
      question_type: null,
      z_score: z,
      direction: z >= 0 ? "up" : "down",
      classification: classifyDrift({ deviationChange, scoreChange, scoreAvailable }),
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
  const all = await getAllSessionSummaries(userId);
  const drift = await detectDrift(userId).catch(() => ({ events: [] }));
  const findings = buildFindings({
    summaries: summary.summaries,
    allSessionSummaries: all.map((item) => item.summaries),
    driftEvents: drift.events || [],
  });

  if (!findings.length) {
    return { status: "insufficient data", message: "No coaching findings met the configured thresholds." };
  }

  const existingTips = await C3Model.getTipsForUser(userId);
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
      before_value: finding.before_value,
      goal_text: `Move ${finding.metric} closer to your personal baseline.`,
      tip: text.tip,
      why: text.why,
      practice: text.practice,
      approach_label: text.approach_label,
      evidence: finding.evidence,
    };
    tip.id = await C3Model.insertCoachingTip(tip);
    tips.push(tip);
  }

  return { status: "ready", tips };
}

async function evaluateOpenTips(userId) {
  const tips = (await C3Model.getTipsForUser(userId)).filter((tip) => tip.outcome_status === "open");
  const all = await getAllSessionSummaries(userId);
  const results = [];

  for (const tip of tips) {
    const later = all
      .filter((item) => Number(item.session.session_number || 0) > Number((tip.session_number || 0)))
      .slice(0, 2);
    const source = later.length ? later : all.filter((item) => item.session.id !== tip.session_id).slice(-2);
    const matching = source.flatMap((item) =>
      item.summaries.filter((summary) => !tip.question_type || summary.question_type === tip.question_type)
    );
    const values = matching
      .map((summary) => summary.metrics?.[tip.metric]?.mean)
      .filter((value) => value != null);
    if (!values.length) continue;
    const afterValue = round(mean(values));
    const outcomeStatus = evaluateOutcome(Number(tip.before_value), afterValue);
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
    const comparison = await progressComparison(userId).catch(() => null);
    const ratings = await C3Model.getSelfRatings(userId);
    const tips = await C3Model.getTipsForUser(userId);
    all.forEach((item) => {
      const rating = ratings.find((r) => Number(r.session_id) === Number(item.session.id));
      const sessionTips = tips.filter((tip) => Number(tip.session_id) === Number(item.session.id));
      rows.push({
        user_id: userId,
        session_id: item.session.id,
        session_number: item.session.session_number,
        fixed_threshold_progress: comparison?.fixed_threshold_progress?.raw_average_answer_score_change ?? null,
        baseline_relative_progress: comparison?.baseline_relative_progress?.delivery_deviation_change ?? null,
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
  const rows = (await evaluationRows(includeDemo)).filter((row) => row.self_rated_improvement != null);
  const participantCount = new Set(rows.map((row) => row.user_id)).size;
  if (participantCount < 5) {
    return { status: "insufficient data", message: "At least 5 participants are required.", participant_count: participantCount };
  }
  return {
    status: "ready",
    participant_count: participantCount,
    fixed_threshold_spearman: spearmanCorrelation(
      rows.map((row) => ({ x: Number(row.fixed_threshold_progress), y: Number(row.self_rated_improvement) }))
    ),
    baseline_relative_spearman: spearmanCorrelation(
      rows.map((row) => ({ x: Number(row.baseline_relative_progress), y: Number(row.self_rated_improvement) }))
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
