const config = require("../config/thresholds");
const { averageQuestionSummaries, mean, round, classifyDrift } = require("./analytics");
const { driftExplanation } = require("./coaching");
function detectDriftFromSessions(all, userId = null) {
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
  let comparableIndicators = 0;
  metrics.forEach((metric) => {
    const refValues = reference.map((item) => item.aggregate.average_metrics[metric]).filter((x) => x != null);
    const recentValue = recentAgg.average_metrics[metric];
    const recentValues = recent.map((item) => item.aggregate.average_metrics[metric]);
    if (refValues.length < 2 || recentValues.some((value) => value == null) || recentValue == null) return;
    comparableIndicators++;
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
    event.baseline_refresh_suggested = Math.abs(z) >= config.DRIFT_Z_THRESHOLD * config.REFRESH_MULTIPLIER;
    events.push(event);
  });

  if (!comparableIndicators) return { status: "insufficient data", message: "Not enough comparable expression indicators in reference and recent sessions.", events: [] };
  return { status: "ready", events };
}
module.exports = { detectDriftFromSessions };
