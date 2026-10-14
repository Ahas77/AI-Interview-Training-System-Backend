"""Candidate-specific baseline statistics."""

from __future__ import annotations

from collections.abc import Iterable
from statistics import mean, pstdev
from typing import Any


def calculate_baseline(samples: Iterable[dict[str, Any]]) -> dict[str, dict[str, float | int | None]]:
    """Return mean, standard deviation and count for each measured feature."""
    values_by_feature: dict[str, list[float]] = {}
    for sample in samples:
        for feature, value in sample.items():
            if isinstance(value, (int, float)) and value == value:
                values_by_feature.setdefault(feature, []).append(float(value))

    return {
        feature: {
            "mean": mean(values),
            "std": pstdev(values) if len(values) > 1 else 0.0,
            "count": len(values),
        }
        for feature, values in values_by_feature.items()
        if values
    }
