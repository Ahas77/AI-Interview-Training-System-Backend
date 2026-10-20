const VOCAL_FEATURES = [
  "f0",
  "pitch_variability",
  "speech_rate",
  "average_pause_duration",
  "pause_frequency",
  "vocal_energy",
  "jitter",
  "mfcc",
];

const FACIAL_FEATURES = [
  "facial_landmark_movement",
  "facial_movement_intensity",
  "head_movement",
  "blink_rate",
  "mouth_movement",
];

const ALL_FEATURES = [...VOCAL_FEATURES, ...FACIAL_FEATURES];
const DEVIATION_THRESHOLD_PERCENT = 15;

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function numericValues(value) {
  if (typeof value === "number" && Number.isFinite(value)) return [value];
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "number" && Number.isFinite(item));
  }
  return [];
}

function getFeatureValue(sample, feature) {
  const vocal = sample.vocal || sample.vocalFeatures || {};
  const facial = sample.facial || sample.facialFeatures || {};
  return numericValues(vocal[feature] ?? facial[feature]);
}

function validateSamples(samples, name) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error(`${name} must contain at least one timestamped sample.`);
  }

  samples.forEach((sample, index) => {
    if (!sample || typeof sample !== "object") {
      throw new Error(`${name}[${index}] must be an object.`);
    }
    if (!Number.isFinite(Number(sample.timestampMs)) || Number(sample.timestampMs) < 0) {
      throw new Error(`${name}[${index}].timestampMs must be a non-negative number.`);
    }
  });
}

function calculateFeatureSummary(samples) {
  return Object.fromEntries(
    ALL_FEATURES.map((feature) => {
      const values = samples.flatMap((sample) => getFeatureValue(sample, feature));
      return [feature, mean(values)];
    })
  );
}

function calculateDeviation(baseline, interview) {
  return Object.fromEntries(
    ALL_FEATURES.map((feature) => {
      const baselineValue = baseline[feature];
      const interviewValue = interview[feature];

      if (baselineValue === null || interviewValue === null) {
        return [
          feature,
          {
            baseline: baselineValue,
            interview: interviewValue,
            changePercent: null,
            direction: "insufficient_data",
          },
        ];
      }

      const denominator = Math.abs(baselineValue);
      const changePercent =
        denominator < Number.EPSILON
          ? (Math.abs(interviewValue) < Number.EPSILON ? 0 : null)
          : ((interviewValue - baselineValue) / denominator) * 100;

      return [
        feature,
        {
          baseline: baselineValue,
          interview: interviewValue,
          changePercent,
          direction:
            changePercent === null
              ? "insufficient_baseline"
              : changePercent > 0
                ? "increased"
                : changePercent < 0
                  ? "decreased"
                  : "unchanged",
        },
      ];
    })
  );
}

function buildAnalysisResult(baselineSamples, interviewSamples, thresholdPercent = DEVIATION_THRESHOLD_PERCENT) {
  const baseline = calculateFeatureSummary(baselineSamples);
  const interview = calculateFeatureSummary(interviewSamples);
  const features = calculateDeviation(baseline, interview);
  const deviations = Object.entries(features)
    .filter(([, item]) => typeof item.changePercent === "number")
    .filter(([, item]) => Math.abs(item.changePercent) >= thresholdPercent);

  return {
    generatedAt: new Date().toISOString(),
    thresholdPercent,
    baseline: {
      sampleCount: baselineSamples.length,
      startedAtMs: Number(baselineSamples[0].timestampMs),
      endedAtMs: Number(baselineSamples[baselineSamples.length - 1].timestampMs),
      features: baseline,
    },
    interview: {
      sampleCount: interviewSamples.length,
      startedAtMs: Number(interviewSamples[0].timestampMs),
      endedAtMs: Number(interviewSamples[interviewSamples.length - 1].timestampMs),
      features: interview,
    },
    features,
    overallStatus: deviations.length > 0 ? "behavioral_deviation_detected" : "within_personal_baseline",
    mainChanges: deviations.map(([feature, item]) => ({
      feature,
      changePercent: Number(item.changePercent.toFixed(2)),
      direction: item.direction,
    })),
    timestamps: interviewSamples.map((sample) => Number(sample.timestampMs)),
  };
}

function validateBaselineDuration(samples) {
  const first = Number(samples[0].timestampMs);
  const last = Number(samples[samples.length - 1].timestampMs);
  const durationSeconds = (last - first) / 1000;
  if (durationSeconds < 30 || durationSeconds > 60) {
    throw new Error("Baseline duration must be between 30 and 60 seconds.");
  }
  return durationSeconds;
}

module.exports = {
  VOCAL_FEATURES,
  FACIAL_FEATURES,
  ALL_FEATURES,
  DEVIATION_THRESHOLD_PERCENT,
  validateSamples,
  validateBaselineDuration,
  calculateFeatureSummary,
  buildAnalysisResult,
};
