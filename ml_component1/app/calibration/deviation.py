"""Standardized deviation and Personalized Deviation Score (PDS) calculations for Component 1.

Implements the mathematical formulation defined in Section 3.2.7 of the research proposal:
1. Standardized Feature Deviation:
       D_f(t) = |X_f(t) - mu_f| / (sigma_f + epsilon)
2. Relative Percentage Deviation:
       Delta%_f = ((X_f(t) - mu_f) / (|mu_f| + epsilon)) * 100%
3. Vocal Deviation Score:
       PDS_vocal(t) = sum(w_f * D_f(t)) for f in vocal
4. Facial Deviation Score:
       PDS_facial(t) = sum(w_f * D_f(t)) for f in facial
5. Multimodal Behavioral Deviation Score:
       PDS_multi(t) = w_v * PDS_vocal(t) + w_f * PDS_facial(t)
"""

from __future__ import annotations

import math
from typing import Any

from app.calibration.baseline import FACIAL_FEATURES, VOCAL_FEATURES

EPSILON = 1e-6
DEFAULT_THRESHOLD_PERCENT = 15.0


def calculate_feature_deviation(
    baseline_stat: dict[str, Any],
    current_value: float,
) -> dict[str, Any]:
    """Calculate standardized D_f and percentage change for a single feature."""
    mu = float(baseline_stat.get("mean", 0.0))
    sigma = float(baseline_stat.get("std", 0.0))

    diff = current_value - mu

    # Percentage change relative to candidate baseline
    denom = abs(mu)
    if denom < EPSILON:
        change_percent = 0.0 if abs(current_value) < EPSILON else 100.0
    else:
        change_percent = (diff / denom) * 100.0

    # Standardized deviation D_f(t)
    standardized_dev = abs(diff) / (sigma + EPSILON)

    # Z-score with sign
    z_score = diff / (sigma + EPSILON)

    direction = (
        "increased"
        if change_percent > 0.05
        else "decreased"
        if change_percent < -0.05
        else "unchanged"
    )

    return {
        "baseline_mean": round(mu, 4),
        "baseline_std": round(sigma, 4),
        "current": round(current_value, 4),
        "difference": round(diff, 4),
        "percentage_deviation": round(change_percent, 2),
        "standardized_deviation": round(standardized_dev, 4),
        "z_score": round(z_score, 4),
        "direction": direction,
    }


def calculate_deviations(
    baseline: dict[str, Any],
    interview: dict[str, float],
    threshold_percent: float = DEFAULT_THRESHOLD_PERCENT,
    vocal_weight: float = 0.5,
    facial_weight: float = 0.5,
) -> dict[str, Any]:
    """Calculate vocal, facial, and multimodal Personalized Deviation Scores (PDS)."""
    # Extract feature stats map from baseline object if nested
    feature_stats: dict[str, dict[str, Any]] = (
        baseline.get("features", baseline) if isinstance(baseline, dict) else {}
    )

    features: dict[str, dict[str, Any]] = {}
    main_changes: list[dict[str, Any]] = []

    vocal_deviations: list[float] = []
    facial_deviations: list[float] = []

    # Process all features
    for feature, stat in feature_stats.items():
        if feature not in interview:
            continue
        val = interview[feature]
        if not isinstance(val, (int, float)) or math.isnan(val):
            continue

        item = calculate_feature_deviation(stat, float(val))
        features[feature] = item

        # Group for PDS calculation
        if feature in VOCAL_FEATURES:
            vocal_deviations.append(item["standardized_deviation"])
        elif feature in FACIAL_FEATURES:
            facial_deviations.append(item["standardized_deviation"])

        # Check threshold
        if abs(item["percentage_deviation"]) >= threshold_percent:
            sign = "+" if item["percentage_deviation"] > 0 else ""
            main_changes.append(
                {
                    "feature": feature,
                    "percentage_deviation": item["percentage_deviation"],
                    "display_change": f"{sign}{item['percentage_deviation']:.1f}%",
                    "direction": item["direction"],
                }
            )

    # Calculate PDS scores
    pds_vocal = float(sum(vocal_deviations) / len(vocal_deviations)) if vocal_deviations else 0.0
    pds_facial = float(sum(facial_deviations) / len(facial_deviations)) if facial_deviations else 0.0
    pds_multi = (vocal_weight * pds_vocal) + (facial_weight * pds_facial)

    # Generate Human-Interpretable Explainable Summary
    change_descriptions = []
    for c in main_changes:
        name = c["feature"].replace("_", " ")
        change_descriptions.append(f"{c['direction']} {name} ({c['display_change']})")

    summary_text = (
        f"Behavioral deviation detected: {'; '.join(change_descriptions)}."
        if main_changes
        else "Vocal and facial behavior within personal baseline range."
    )

    return {
        "features": features,
        "pds": {
            "vocal": round(pds_vocal, 4),
            "facial": round(pds_facial, 4),
            "multimodal": round(pds_multi, 4),
        },
        "main_changes": main_changes,
        "overall_status": (
            "behavioral_deviation_detected" if main_changes else "within_personal_baseline"
        ),
        "explainable_summary": summary_text,
        "interpretation_note": (
            "Measurements represent candidate-specific behavioral deviation relative to their own "
            "warm-up baseline. These indicators do not constitute medical, psychological, or deception diagnoses."
        ),
    }
