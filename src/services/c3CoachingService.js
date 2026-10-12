const AIProvider = require("./ai/aiProvider");
const config = require("../config/c3Config");
const {
  mean,
  round,
  averageQuestionSummaries,
  classifyDrift,
} = require("./c3AnalyticsService");

function buildFindings({ summaries, allSessionSummaries = [], driftEvents = [] }) {
  const findings = [];
  const byType = {};

  summaries.forEach((summary) => {
    Object.entries(summary.metrics || {}).forEach(([metric, data]) => {
      if (data.deviation == null || data.status !== "ok") return;
      const severity = Math.abs(data.deviation);
      if (severity >= config.DRIFT_Z_THRESHOLD) {
        findings.push({
          metric,
          question_type: summary.question_type,
          qa_id: summary.qa_id,
          before_value: data.mean,
          baseline_value: data.baseline_mean,
          deviation: data.deviation,
          peak_t_sec: data.peak_t_sec,
          answer_score: summary.answer_score,
          severity,
          evidence: `${metric} averaged ${data.mean}, compared with this user's baseline ${data.baseline_mean}; delivery deviation was ${data.deviation} standard deviations.`,
          rule: "metric_deviation_from_personal_baseline",
        });
      }
    });

    if (!byType[summary.question_type]) byType[summary.question_type] = [];
    byType[summary.question_type].push(summary);
  });

  Object.entries(byType).forEach(([questionType, items]) => {
    const typeAvgDeviation = mean(items.map((item) => item.delivery_deviation).filter((x) => x != null));
    if (typeAvgDeviation != null && typeAvgDeviation >= config.DRIFT_Z_THRESHOLD) {
      findings.push({
        metric: "delivery_deviation",
        question_type: questionType,
        qa_id: items[0]?.qa_id,
        before_value: round(typeAvgDeviation),
        baseline_value: 0,
        deviation: round(typeAvgDeviation),
        severity: typeAvgDeviation,
        evidence: `${questionType} questions averaged delivery deviation ${round(typeAvgDeviation)} against the user's own baseline.`,
        rule: "weak_question_type",
      });
    }
  });

  const latest = averageQuestionSummaries(summaries);
  const previous = allSessionSummaries.length > 1 ? averageQuestionSummaries(allSessionSummaries[allSessionSummaries.length - 2]) : null;
  if (
    latest.average_delivery_deviation != null &&
    previous?.average_delivery_deviation != null &&
    latest.average_delivery_deviation < previous.average_delivery_deviation
  ) {
    findings.push({
      metric: "delivery_deviation",
      question_type: null,
      qa_id: null,
      before_value: latest.average_delivery_deviation,
      baseline_value: previous.average_delivery_deviation,
      deviation: round(latest.average_delivery_deviation - previous.average_delivery_deviation),
      severity: 0.5,
      evidence: `Delivery deviation improved from ${previous.average_delivery_deviation} to ${latest.average_delivery_deviation} compared with the previous session.`,
      rule: "improvement_worth_congratulating",
    });
  }

  driftEvents.forEach((event) => {
    findings.push({
      metric: event.metric,
      question_type: event.question_type || null,
      qa_id: null,
      before_value: event.z_score,
      baseline_value: 0,
      deviation: event.z_score,
      severity: Math.abs(event.z_score),
      evidence: `Recent ${event.metric} changed by z=${event.z_score}; classified as ${event.classification}.`,
      rule: "drift_event",
    });
  });

  return findings.sort((a, b) => b.severity - a.severity).slice(0, 3);
}

function fallbackTip(finding, shorter = false) {
  const exerciseLength = shorter ? "5 minutes" : "10 minutes";
  const metricLabel = String(finding.metric || "delivery").replace(/_/g, " ");
  return {
    tip: `Practice one focused answer while monitoring your ${metricLabel}. Keep the delivery steady and close to your normal baseline.`,
    why: finding.evidence,
    practice: `For ${exerciseLength}, answer one common interview question, pause once before speaking, and replay your answer to check whether your delivery stayed consistent.`,
    approach_label: shorter ? "short_reflection" : "steady_delivery_rehearsal",
  };
}

async function generateTipText(finding, preferShorter = false) {
  const systemPrompt = `
You are an interview coach. Use only the facts provided.
Do not invent causes, numbers, diagnoses, stress labels, or true emotion labels.
Use the terms "delivery deviation" and "expression indicators".
Return strict JSON: {"tip":"...","why":"...","practice":"...","approach_label":"..."}.
`;
  const userPrompt = JSON.stringify({
    finding,
    instruction: preferShorter
      ? "The candidate did not follow a previous tip. Suggest a shorter exercise."
      : "Give one concrete coaching tip with a short practice exercise.",
  });

  try {
    const response = await AIProvider.generateJSON(systemPrompt, userPrompt);
    const cleaned = String(response || "").replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.tip && parsed.why && parsed.practice) {
      return {
        tip: String(parsed.tip),
        why: String(parsed.why),
        practice: String(parsed.practice),
        approach_label: String(parsed.approach_label || "llm_coaching"),
      };
    }
  } catch (error) {
    console.warn("C3 coaching LLM fallback used:", error.message);
  }

  return fallbackTip(finding, preferShorter);
}

function evaluateOutcome(beforeValue, afterValue) {
  if (beforeValue == null || afterValue == null) return "open";
  const diff = Number(afterValue) - Number(beforeValue);
  if (diff < -config.OUTCOME_MARGIN) return "improved";
  if (diff > config.OUTCOME_MARGIN) return "worse";
  return "no_change";
}

function driftExplanation(event, scoreAvailable) {
  const scoreText = scoreAvailable
    ? "answer score was available for classification"
    : "no score was available, so classification used delivery deviation only";
  return `${event.metric} moved ${event.direction} with z=${event.z_score}. This is classified as ${event.classification}; ${scoreText}.`;
}

module.exports = {
  buildFindings,
  generateTipText,
  fallbackTip,
  evaluateOutcome,
  classifyDrift,
  driftExplanation,
};
