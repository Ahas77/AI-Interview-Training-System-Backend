"""Feature-level deviation and explainable status calculations."""

from __future__ import annotations

from typing import Any


def calculate_deviations(
    baseline: dict[str, dict[str, float | int | None]],
    interview: dict[str, float],
    threshold_percent: float = 15.0,
) -> dict[str, Any]:
    features: dict[str, dict[str, Any]] = {}
    main_changes: list[dict[str, Any]] = []

    for feature, stats in baseline.items():
        if feature not in interview:
            continue
        baseline_value = float(stats["mean"])
        current_value = float(interview[feature])
        difference = current_value - baseline_value
        percentage = None if baseline_value == 0 else difference / abs(baseline_value) * 100
        std = float(stats["std"] or 0)
        z_score = None if std == 0 else difference / std
        direction = "insufficient_baseline" if percentage is None else (
            "increased" if percentage > 0 else "decreased" if percentage < 0 else "unchanged"
        )
        item = {
            "baseline": baseline_value,
            "current": current_value,
            "difference": round(difference, 3),
            "percentage_deviation": round(percentage, 2) if percentage is not None else None,
            "z_score": round(z_score, 3) if z_score is not None else None,
            "direction": direction,
        }
        features[feature] = item
        if percentage is not None and abs(percentage) >= threshold_percent:
            main_changes.append(
                {"feature": feature, "percentage_deviation": item["percentage_deviation"], "direction": direction}
            )

    return {
        "features": features,
        "main_changes": main_changes,
        "overall_status": (
            "behavioral_deviation_detected" if main_changes else "within_personal_baseline"
        ),
        "interpretation_note": (
            "Deviations describe change from this candidate's baseline; they are not proof "
            "of confidence, stress or another psychological state."
        ),
    }
