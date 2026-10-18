"""FastAPI backend service for Component 1 - PP1 Scope.

Multimodal Personalized Behavioral Analysis – Vocal & Facial Baseline Prototype.
Implements:
- 8 Vocal features extraction
- 5 Facial features extraction
- 30-60 second candidate-specific baseline calibration
- Standardized feature deviations D_f(t) and Personalized Deviation Scores (PDS)
- Explainable human-readable dashboard summary
"""

from __future__ import annotations

import os
import tempfile
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.calibration.baseline import calculate_baseline
from app.calibration.deviation import calculate_deviations
from app.features.audio_features import (
    extract_audio_features,
    extract_audio_features_from_bytes,
)
from app.features.facial_features import (
    extract_facial_features,
    extract_facial_features_from_video,
)

app = FastAPI(
    title="Component 1 - Vocal & Facial Behavioral Baseline Engine (PP1 50%)",
    description="Multimodal personalized behavioral analysis prototype for interview coaching.",
    version="1.0.0",
)

# Enable CORS for frontend and Node.js gateway
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------ Request / Response Schemas ------------------


class AudioSamplesRequest(BaseModel):
    samples: List[float] = Field(..., min_length=100)
    sample_rate: int = Field(default=16000, ge=8000, le=48000)
    transcript_text: Optional[str] = None


class LandmarkFrameRequest(BaseModel):
    landmarks: List[List[float]] = Field(..., description="Array of [x, y] or [x, y, z] points")
    previous_landmarks: Optional[List[List[float]]] = None
    frame_delta_seconds: float = Field(default=0.033, gt=0.0)
    blink_count: int = Field(default=0, ge=0)
    mouth_open_ratio: Optional[float] = None
    total_duration_seconds: float = Field(default=1.0, gt=0.0)


class BaselineCalibrationRequest(BaseModel):
    samples: List[Dict[str, Any]] = Field(..., min_length=1)
    duration_seconds: Optional[float] = Field(default=45.0, ge=5.0)


class InterviewAnalysisRequest(BaseModel):
    baseline: Dict[str, Any] = Field(..., description="Calibrated baseline statistics object")
    interview: Dict[str, float] = Field(..., description="Interview feature values")
    threshold_percent: float = Field(default=15.0, ge=0.0)
    vocal_weight: float = Field(default=0.5, ge=0.0, le=1.0)
    facial_weight: float = Field(default=0.5, ge=0.0, le=1.0)


class FullSessionRequest(BaseModel):
    warm_up_samples: List[Dict[str, Any]] = Field(..., min_length=1)
    warm_up_duration_seconds: float = Field(default=45.0, ge=10.0)
    interview_samples: List[Dict[str, Any]] = Field(..., min_length=1)
    threshold_percent: float = Field(default=15.0, ge=0.0)


class LegacyCalibrationRequest(BaseModel):
    baseline: Dict[str, float] = Field(..., min_length=1)
    interview: Dict[str, float] = Field(..., min_length=1)
    threshold_percent: float = Field(default=15.0, ge=0.0)


# ------------------ API Endpoints ------------------


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "healthy",
        "component": "C1 - Multimodal Personalized Behavioral Analysis",
        "pp1_scope_completed": "50%",
        "vocal_features_count": 8,
        "facial_features_count": 5,
        "baseline_ready": True,
        "pds_scoring_ready": True,
    }


@app.post("/api/c1/vocal/extract-from-samples")
def extract_vocal_from_samples(req: AudioSamplesRequest) -> dict[str, Any]:
    """Extract the 8 PP1 vocal features from raw PCM samples."""
    import numpy as np

    try:
        audio_arr = np.asarray(req.samples, dtype=np.float32)
        features = extract_audio_features(
            audio_arr, sample_rate=req.sample_rate, transcript_text=req.transcript_text
        )
        return {"success": True, "features": features}
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/api/c1/vocal/extract-from-file")
async def extract_vocal_from_file(
    file: UploadFile = File(...),
    transcript_text: Optional[str] = Form(None),
) -> dict[str, Any]:
    """Extract the 8 PP1 vocal features from an uploaded audio file (WAV, MP3, etc.)."""
    try:
        contents = await file.read()
        features = extract_audio_features_from_bytes(
            contents, target_sample_rate=16000, transcript_text=transcript_text
        )
        return {"success": True, "filename": file.filename, "features": features}
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Audio extraction failed: {error}") from error


@app.post("/api/c1/facial/extract-from-landmarks")
def extract_facial_from_landmarks(req: LandmarkFrameRequest) -> dict[str, Any]:
    """Extract the 5 PP1 facial features from landmark coordinates."""
    import numpy as np

    try:
        curr = np.asarray(req.landmarks, dtype=np.float32)
        prev = np.asarray(req.previous_landmarks, dtype=np.float32) if req.previous_landmarks else None
        features = extract_facial_features(
            previous_landmarks=prev,
            landmarks=curr,
            frame_delta_seconds=req.frame_delta_seconds,
            blink_count=req.blink_count,
            mouth_open_ratio=req.mouth_open_ratio,
            total_duration_seconds=req.total_duration_seconds,
        )
        return {"success": True, "features": features}
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/api/c1/facial/extract-from-video")
async def extract_facial_from_video(
    file: UploadFile = File(...),
    max_frames: Optional[int] = Form(600),
) -> dict[str, Any]:
    """Extract the 5 PP1 facial features from an uploaded video file (MP4, WebM)."""
    temp_path = None
    try:
        suffix = os.path.splitext(file.filename or "video.mp4")[1] or ".mp4"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            temp_path = tmp.name
            contents = await file.read()
            tmp.write(contents)

        features = extract_facial_features_from_video(temp_path, max_frames=max_frames)
        return {"success": True, "filename": file.filename, "features": features}
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Video extraction failed: {error}") from error
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


@app.post("/api/c1/baseline/calibrate")
def calibrate_baseline(req: BaselineCalibrationRequest) -> dict[str, Any]:
    """Calibrate candidate-specific baseline B_f = (mu_f, sigma_f) from a 30-60s warm-up."""
    try:
        baseline_stats = calculate_baseline(req.samples, duration_seconds=req.duration_seconds)
        return {"success": True, "baseline": baseline_stats}
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/api/c1/interview/analyze")
def analyze_interview(req: InterviewAnalysisRequest) -> dict[str, Any]:
    """Compare interview features against candidate baseline to calculate PDS and deviation."""
    try:
        result = calculate_deviations(
            baseline=req.baseline,
            interview=req.interview,
            threshold_percent=req.threshold_percent,
            vocal_weight=req.vocal_weight,
            facial_weight=req.facial_weight,
        )
        return {"success": True, **result}
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/api/c1/full-session")
def process_full_session(req: FullSessionRequest) -> dict[str, Any]:
    """Process a complete warm-up and mock interview session end-to-end."""
    try:
        baseline = calculate_baseline(
            req.warm_up_samples, duration_seconds=req.warm_up_duration_seconds
        )

        # Calculate average interview features across interview samples
        from statistics import mean

        feature_values: dict[str, list[float]] = {}
        for sample in req.interview_samples:
            vocal_dict = sample.get("vocal") or sample.get("vocalFeatures") or {}
            facial_dict = sample.get("facial") or sample.get("facialFeatures") or {}
            for k in list(baseline["features"].keys()):
                val = sample.get(k)
                if val is None:
                    val = vocal_dict.get(k)
                if val is None:
                    val = facial_dict.get(k)
                if isinstance(val, (int, float)):
                    feature_values.setdefault(k, []).append(float(val))

        avg_interview = {k: mean(v) for k, v in feature_values.items() if v}

        analysis = calculate_deviations(
            baseline=baseline,
            interview=avg_interview,
            threshold_percent=req.threshold_percent,
        )

        return {
            "success": True,
            "baseline": baseline,
            "interview_summary": avg_interview,
            **analysis,
        }
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


# ------------------ Legacy Endpoint ------------------


@app.post("/calibrate")
def legacy_calibrate(request: LegacyCalibrationRequest) -> dict[str, object]:
    """Legacy compatibility endpoint."""
    baseline_samples = [{feature: value} for feature, value in request.baseline.items()]
    baseline_statistics = calculate_baseline(baseline_samples)
    return {
        "baseline": baseline_statistics["features"],
        **calculate_deviations(
            baseline_statistics,
            request.interview,
            request.threshold_percent,
        ),
    }
