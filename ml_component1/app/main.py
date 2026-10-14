"""FastAPI entry point for the isolated Component 1 calibration service."""

from typing import Dict

from fastapi import FastAPI
from pydantic import BaseModel, Field

from app.calibration.baseline import calculate_baseline
from app.calibration.deviation import calculate_deviations

app = FastAPI(title="Component 1 - Baseline Calibration API", version="1.0.0")


class CalibrationRequest(BaseModel):
    baseline: Dict[str, float] = Field(..., min_length=1)
    interview: Dict[str, float] = Field(..., min_length=1)
    threshold_percent: float = Field(default=15.0, ge=0.0)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "healthy", "component": "C1"}


@app.post("/calibrate")
def calibrate(request: CalibrationRequest) -> dict[str, object]:
    baseline_samples = [{feature: value} for feature, value in request.baseline.items()]
    baseline_statistics = calculate_baseline(baseline_samples)
    return {
        "baseline": baseline_statistics,
        **calculate_deviations(
            baseline_statistics,
            request.interview,
            request.threshold_percent,
        ),
    }
