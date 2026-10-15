const config = require("../config/c3Config");

function safeJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_e) {
    return fallback;
  }
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values, avg = mean(values)) {
  if (!values.length || avg == null) return config.BASELINE_STD_FLOOR;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / values.length;
  return Math.max(Math.sqrt(variance), config.BASELINE_STD_FLOOR);
}

function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function round(value, digits = 4) {
  if (value == null || Number.isNaN(Number(value))) return null;
  return Number(Number(value).toFixed(digits));
}

function buildBaselineMetrics(signals) {
  const grouped = {};

  for (const signal of signals) {
    const metrics = safeJson(signal.metrics, {});
    Object.entries(metrics || {}).forEach(([metric, value]) => {
      if (typeof value !== "number" || metric.startsWith("browser_")) return;
      const number = value;
      if (!Number.isFinite(number)) return;
      if (!grouped[metric]) grouped[metric] = [];
      grouped[metric].push(number);
    });
  }

  const metrics = {};
  const counts = [];
  Object.entries(grouped).forEach(([metric, values]) => {
    const avg = mean(values);
    metrics[metric] = {
      mean: round(avg),
      std: round(std(values, avg)),
      n: values.length,
    };
    counts.push(values.length);
  });

  const avgReadings = counts.length ? mean(counts) : 0;
  const confidence = Math.max(
    0,
    Math.min(1, avgReadings / config.BASELINE_CONFIDENCE_TARGET_READINGS)
  );

  return {
    metrics,
    confidence: round(confidence),
  };
}

function summarizeMetricReadings(readings, baselineMetrics) {
  const grouped = {};

  for (const reading of readings) {
    const metrics = safeJson(reading.metrics, {});
    Object.entries(metrics || {}).forEach(([metric, value]) => {
      if (typeof value !== "number" || metric.startsWith("browser_")) return;
      const number = value;
      if (!Number.isFinite(number)) return;
      if (!grouped[metric]) grouped[metric] = [];
      grouped[metric].push({
        value: number,
        t_sec: reading.question_relative_t_sec ?? reading.t_sec ?? null,
      });
    });
  }

  const result = {};
  for (const [metric, items] of Object.entries(grouped)) {
    if (items.length < config.MIN_SIGNAL_READINGS_PER_METRIC) {
      result[metric] = {
        status: "insufficient signal",
        n: items.length,
      };
      continue;
    }

    const values = items.map((item) => item.value);
    const avg = mean(values);
    const peak = items.reduce((best, item) => (item.value > best.value ? item : best), items[0]);
    const baseline = baselineMetrics?.[metric];
    const deviation =
      baseline && Number.isFinite(Number(baseline.mean))
        ? (avg - Number(baseline.mean)) / Math.max(Number(baseline.std) || 0, config.BASELINE_STD_FLOOR)
        : null;

    result[metric] = {
      status: baseline ? "ok" : "no baseline",
      mean: round(avg),
      peak: round(peak.value),
      peak_t_sec: round(peak.t_sec, 2),
      n: items.length,
      baseline_mean: baseline ? round(baseline.mean) : null,
      baseline_std: baseline ? round(Math.max(Number(baseline.std) || 0, config.BASELINE_STD_FLOOR)) : null,
      deviation: round(deviation),
    };
  }

  return result;
}

function summarizeQuestions({ qaLogs, signals, baseline }) {
  const baselineMetrics = safeJson(baseline?.metrics, {}) || {};

  return qaLogs
    .filter((qa) => qa.user_answer_text != null || qa.answered_at)
    .map((qa) => {
      const questionStartSec = Number(qa.question_start_sec || 0);
      const questionEndSec =
        qa.answer_end_sec != null ? Number(qa.answer_end_sec) : Number.MAX_SAFE_INTEGER;
      const questionSignals = signals
        .filter((signal) => {
          if (signal.qa_id && Number(signal.qa_id) === Number(qa.id)) return true;
          if (signal.qa_id) return false;
          const tSec = Number(signal.t_sec);
          return tSec >= questionStartSec && tSec <= questionEndSec;
        })
        .map((signal) => ({
          ...signal,
          question_relative_t_sec: Number(signal.t_sec) - questionStartSec,
        }));

      const metrics = summarizeMetricReadings(questionSignals, baselineMetrics);
      const deviations = Object.values(metrics)
        .filter((metric) => metric.status === "ok" && metric.deviation != null)
        .map((metric) => Math.abs(metric.deviation));

      return {
        qa_id: qa.id,
        question_number: qa.question_number,
        question_type: qa.question_type || "hr",
        question_text: qa.question_text,
        answer_score: qa.answer_score == null ? null : Number(qa.answer_score),
        answer_feedback: qa.answer_feedback || null,
        answer_word_count:
          qa.answer_word_count == null ? wordCount(qa.user_answer_text) : Number(qa.answer_word_count),
        response_latency_sec:
          qa.response_latency_sec == null ? null : Number(qa.response_latency_sec),
        metrics,
        signal_status: questionSignals.length ? "available" : "insufficient signal",
        delivery_deviation: deviations.length ? round(mean(deviations)) : null,
      };
    });
}

function averageQuestionSummaries(summaries) {
  const answered = summaries.filter((item) => item.delivery_deviation != null || item.answer_score != null);
  const metricBuckets = {};

  summaries.forEach((summary) => {
    Object.entries(summary.metrics || {}).forEach(([metric, value]) => {
      if (value.mean == null) return;
      if (!metricBuckets[metric]) metricBuckets[metric] = [];
      metricBuckets[metric].push(Number(value.mean));
    });
  });

  const averageMetrics = {};
  Object.entries(metricBuckets).forEach(([metric, values]) => {
    averageMetrics[metric] = round(mean(values));
  });

  return {
    average_delivery_deviation: round(mean(answered.map((x) => x.delivery_deviation).filter((x) => x != null))),
    average_answer_score: round(mean(answered.map((x) => x.answer_score).filter((x) => x != null))),
    average_metrics: averageMetrics,
    answered_question_count: summaries.length,
  };
}

function classifyDrift({ deviationChange, scoreChange, scoreAvailable }) {
  if (deviationChange == null) return "none";
  if (deviationChange < 0 && scoreAvailable && scoreChange != null && scoreChange >= 0) return "improvement";
  if (deviationChange > 0 && scoreAvailable && scoreChange != null && scoreChange < 0) return "decline";
  if (Math.abs(deviationChange) > 0) return "behaviour_shift";
  return "none";
}

function spearmanCorrelation(pairs) {
  const valid = pairs.filter((pair) => Number.isFinite(pair.x) && Number.isFinite(pair.y));
  if (valid.length < 2) return null;

  const rank = (values) => {
    const sorted = values
      .map((value, index) => ({ value, index }))
      .sort((a, b) => a.value - b.value);
    const ranks = new Array(values.length);
    for (let i = 0; i < sorted.length; i++) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1].value === sorted[i].value) j++;
      const avgRank = (i + j + 2) / 2;
      for (let k = i; k <= j; k++) ranks[sorted[k].index] = avgRank;
      i = j;
    }
    return ranks;
  };

  const rx = rank(valid.map((pair) => pair.x));
  const ry = rank(valid.map((pair) => pair.y));
  const avgRx = mean(rx);
  const avgRy = mean(ry);
  const numerator = rx.reduce((sum, value, index) => sum + (value - avgRx) * (ry[index] - avgRy), 0);
  const denominator = Math.sqrt(
    rx.reduce((sum, value) => sum + Math.pow(value - avgRx, 2), 0) *
      ry.reduce((sum, value) => sum + Math.pow(value - avgRy, 2), 0)
  );

  return denominator === 0 ? null : round(numerator / denominator);
}

module.exports = {
  safeJson,
  mean,
  std,
  wordCount,
  round,
  buildBaselineMetrics,
  summarizeQuestions,
  averageQuestionSummaries,
  classifyDrift,
  spearmanCorrelation,
};
