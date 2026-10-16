const { generateJSON } = require("./llm");
const config = require("../config/thresholds");
const {
  mean,
  round,
  averageQuestionSummaries,
  classifyDrift,
} = require("./analytics");

function buildFindings({ summaries, allSessionSummaries = [], driftEvents = [] }) {
  const findings = [];
  const byType = {};

  summaries.forEach((summary) => {
    if (summary.answer_score != null && summary.answer_score < config.LOW_ANSWER_SCORE) {
      findings.push({ metric: "answer_score", question_type: summary.question_type,
        qa_id: summary.qa_id, before_value: summary.answer_score, baseline_value: null,
        deviation: 0, severity: (100 - summary.answer_score) / 10,
        evidence: `Question ${summary.question_number} (${summary.question_type}) has a recorded answer score of ${summary.answer_score}/100, below the coaching threshold ${config.LOW_ANSWER_SCORE}.`,
        rule: "answer_content_rubric", feedback: "Give a direct answer, add one specific example, and explain the result." });
    }
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
      deviation: latest.average_delivery_deviation,
      severity: 0.5,
      evidence: `Delivery deviation improved from ${previous.average_delivery_deviation} to ${latest.average_delivery_deviation} compared with the previous session.`,
      rule: "improvement_worth_congratulating",
    });
  }

  driftEvents.forEach((event) => {
    const comparable = summaries.flatMap((summary) => {
      const metric = summary.metrics?.[event.metric];
      return metric?.status === "ok" && metric.deviation != null ? [metric] : [];
    });
    findings.push({
      metric: event.metric,
      question_type: event.question_type || null,
      qa_id: null,
      before_value: comparable.length ? mean(comparable.map((metric) => metric.mean)) : null,
      baseline_value: comparable[0]?.baseline_mean ?? null,
      deviation: comparable.length ? mean(comparable.map((metric) => Math.abs(metric.deviation))) : null,
      severity: Math.abs(event.z_score),
      evidence: `Recent ${event.metric} changed by z=${event.z_score}; classified as ${event.classification}.`,
      rule: "drift_event",
    });
  });

  // Keep the highest-priority finding per indicator/type, rather than repeating the same advice.
  const unique = new Map();
  for (const finding of findings.sort((a, b) => b.severity - a.severity)) {
    const key = `${finding.metric}:${finding.question_type || "overall"}`;
    if (!unique.has(key)) unique.set(key, finding);
  }
  return [...unique.values()].slice(0, config.MAX_FINDINGS);
}

function fallbackTip(finding, shorter = false, alternate = false) {
  const exerciseLength = shorter ? "2 minutes" : "5 minutes";
  const metricLabel = String(finding.metric || "delivery").replace(/_/g, " ");
  return {
    tip: finding.metric === "answer_score" ? finding.feedback :
      finding.metric === "gaze_off" ? "Place your interview notes close to the camera and practise returning your gaze to it between thoughts." :
        finding.metric === "head_turn" ? "Place the camera at eye level and practise answering while facing it comfortably." :
          `Practice one focused answer while monitoring your ${metricLabel}. Keep the delivery steady and close to your normal baseline.`,
    why: finding.evidence,
    practice: finding.metric === "answer_score" ?
      `For ${exerciseLength}, rewrite this answer with a direct opening, one concrete example and a clear result. Check it against the feedback, then answer again without reading.` :
      `For ${exerciseLength}, answer one common interview question, pause once before speaking, and replay your answer to check whether your delivery stayed consistent.`,
    approach_label: alternate ? "outline_then_rehearse" : shorter ? "short_reflection" : "steady_delivery_rehearsal",
  };
}

async function generateTipText(finding, preferShorter = false, alternate = false) {
  const systemPrompt = `
You are an interview coach. Use only the facts provided.
Do not invent causes, numbers, diagnoses, stress labels, or true emotion labels.
Use the terms "delivery deviation" and "expression indicators".
Return strict JSON: {"tip":"...","why":"...","practice":"...","approach_label":"..."}.
`;
  const userPrompt = JSON.stringify({
    finding,
    instruction: alternate ? "A previous exercise was tried but did not help. Use a different approach: outline three points, rehearse, and compare with the evidence." : preferShorter
      ? "The candidate did not follow a previous tip. Suggest a shorter exercise."
      : "Give one concrete coaching tip with a short practice exercise.",
  });

  try {
    const parsed = await generateJSON(systemPrompt, { finding, instruction: userPrompt });
    if ([parsed.tip, parsed.why, parsed.practice].every((value) => typeof value === "string" && value.trim())) {
      return {
        tip: parsed.tip.slice(0, config.MAX_TIP_TEXT),
        why: finding.evidence,
        practice: parsed.practice.slice(0, config.MAX_TIP_TEXT),
        approach_label: String(parsed.approach_label || "llm_coaching").slice(0, 100),
      };
    }
  } catch (error) {
    console.warn("C3 coaching uses a local exercise because the shared AI provider is unavailable.");
  }

  const fallback = fallbackTip(finding, preferShorter, alternate);
  if (alternate) fallback.practice = "Write three bullet points, rehearse a 60-second answer, then replay it and check the indicated measurement. Revise one point and try again.";
  return fallback;
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
