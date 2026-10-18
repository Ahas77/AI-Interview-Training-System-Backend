"""Candidate-specific baseline calibration for Component 1 - PP1 Scope.

Establishes a multimodal behavioral baseline from a 30-60 second low-stakes warm-up
conversation as specified in Section 3.2.6 of the research proposal:
    B_f = (mu_f, sigma_f)
where:
    mu_f = candidate's mean baseline value
    sigma_f = candidate's baseline variability (standard deviation)

Covers all 13 PP1 features (8 vocal + 5 facial).
"""

from __future__ import annotations

from collections.abc import Iterable
import math
from statistics import mean, pstdev
from typing import Any


VOCAL_FEATURES = [
    "f0",
    "pitch_variability",
    "speech_rate",
    "average_pause_duration",
    "pause_frequency",
    "vocal_energy",
    "jitter",
    "mfcc",
]

FACIAL_FEATURES = [
    "facial_landmark_movement",
    "facial_movement_intensity",
    "head_movement",
    "blink_rate",
    "mouth_movement",
]

ALL_PP1_FEATURES = VOCAL_FEATURES + FACIAL_FEATURES


def calculate_baseline(
    samples: Iterable[dict[str, Any]],
    duration_seconds: float | None = None,
) -> dict[str, dict[str, Any]]:
    """Calculate mean, standard deviation, count, min, max for each measured feature."""
    values_by_feature: dict[str, list[float]] = {f: [] for f in ALL_PP1_FEATURES}

    sample_list = list(samples)
    for sample in sample_list:
        # Check both direct keys and nested keys
        vocal_dict = sample.get("vocal") or sample.get("vocalFeatures") or {}
        facial_dict = sample.get("facial") or sample.get("facialFeatures") or {}

        for feature in ALL_PP1_FEATURES:
            val = sample.get(feature)
            if val is None:
                val = vocal_dict.get(feature)
            if val is None:
                val = facial_dict.get(feature)

            if isinstance(val, (int, float)) and not math.isnan(val):
                values_by_feature[feature].append(float(val))

    baseline_statistics: dict[str, dict[str, Any]] = {}
    for feature in ALL_PP1_FEATURES:
        vals = values_by_feature[feature]
        if vals:
            m = float(mean(vals))
            s = float(pstdev(vals)) if len(vals) > 1 else max(abs(m) * 0.05, 1e-4)
            baseline_statistics[feature] = {
                "mean": round(m, 4),
                "std": round(s, 4),
                "count": len(vals),
                "min": round(min(vals), 4),
                "max": round(max(vals), 4),
            }
        else:
            # Feature was not in warm-up payload
            baseline_statistics[feature] = {
                "mean": 0.0,
                "std": 0.0,
                "count": 0,
                "min": 0.0,
                "max": 0.0,
            }

    # Duration validation for 30-60 second warm-up window
    duration_note = "valid_duration"
    if duration_seconds is not None:
        if duration_seconds < 30.0:
            duration_note = "warm_up_shorter_than_recommended_30s"
        elif duration_seconds > 60.0:
            duration_note = "warm_up_longer_than_recommended_60s"

    return {
        "features": baseline_statistics,
        "sample_count": len(sample_list),
        "duration_seconds": round(duration_seconds, 2) if duration_seconds is not None else None,
        "duration_status": duration_note,
    }
