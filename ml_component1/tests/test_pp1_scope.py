"""Validation test suite for Component 1 - PP1 Scope (50% Completion).

Verifies:
1. All 8 PP1 Vocal Features extraction
2. All 5 PP1 Facial Features extraction
3. 30-60 second Personalized Baseline Calibration
4. Standardized Deviations D_f(t) and Personalized Deviation Score (PDS)
5. Exact reproduction of the illustrative proposal test case (Section 5)
6. FastAPI backend endpoints
"""

import os
import sys
from pathlib import Path

# Ensure ml_component1 root is in python path
sys.path.insert(0, str(Path(__file__).parent.parent.resolve()))

import math
import numpy as np
from fastapi.testclient import TestClient

from app.calibration.baseline import (
    ALL_PP1_FEATURES,
    FACIAL_FEATURES,
    VOCAL_FEATURES,
    calculate_baseline,
)
from app.calibration.deviation import calculate_deviations
from app.features.audio_features import extract_audio_features
from app.features.facial_features import extract_facial_features
from app.main import app


def test_vocal_features_count_and_types():
    """Verify all 8 PP1 vocal features are extracted and valid."""
    sr = 16000
    duration = 3.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    # 160 Hz tone with light noise
    signal = 0.5 * np.sin(2 * np.pi * 160 * t) + 0.02 * np.random.randn(len(t))

    res = extract_audio_features(signal, sample_rate=sr)

    expected_vocal = [
        "f0",
        "pitch_variability",
        "speech_rate",
        "average_pause_duration",
        "pause_frequency",
        "vocal_energy",
        "jitter",
        "mfcc",
    ]
    for feat in expected_vocal:
        assert feat in res, f"Missing vocal feature: {feat}"
        val = res[feat]
        assert val is not None, f"Feature {feat} returned None"
        assert isinstance(val, (int, float)), f"Feature {feat} must be numeric"
        assert not math.isnan(val), f"Feature {feat} returned NaN"

    # Physics sanity checks
    assert 130 <= res["f0"] <= 190, f"Expected pitch around 160 Hz, got {res['f0']}"
    assert res["vocal_energy"] > 0, "Vocal energy must be positive"
    assert res["jitter"] >= 0, "Jitter must be non-negative"


def test_facial_features_count_and_types():
    """Verify all 5 PP1 facial features are calculated."""
    landmarks_a = np.random.randn(468, 2).astype(np.float32)
    landmarks_b = landmarks_a + 0.04 * np.random.randn(468, 2).astype(np.float32)

    res = extract_facial_features(
        previous_landmarks=landmarks_a,
        landmarks=landmarks_b,
        frame_delta_seconds=0.033,
        blink_count=4,
        mouth_open_ratio=0.22,
        total_duration_seconds=30.0,
    )

    expected_facial = [
        "facial_landmark_movement",
        "facial_movement_intensity",
        "head_movement",
        "blink_rate",
        "mouth_movement",
    ]
    for feat in expected_facial:
        assert feat in res, f"Missing facial feature: {feat}"
        val = res[feat]
        assert val is not None, f"Facial feature {feat} returned None"
        assert isinstance(val, (int, float)), f"Facial feature {feat} must be numeric"
        assert not math.isnan(val), f"Facial feature {feat} returned NaN"


def test_baseline_calibration_and_window():
    """Verify 30-60 second baseline calibration statistics."""
    sample = {f: 10.0 for f in ALL_PP1_FEATURES}
    baseline = calculate_baseline([sample, sample], duration_seconds=45.0)

    assert baseline["duration_status"] == "valid_duration"
    assert baseline["sample_count"] == 2
    for feat in ALL_PP1_FEATURES:
        assert feat in baseline["features"]
        assert baseline["features"][feat]["mean"] == 10.0


def test_illustrative_proposal_benchmark():
    """Verify exact illustrative values from Section 5 of proposal:

    Feature         Baseline   Interview   Expected Change
    Pitch           145 Hz     172 Hz      +18.6%
    Speech rate     128 WPM    151 WPM     +18.0%
    Pause duration  0.8 s      1.3 s       +62.5%
    Head movement   12/min     8/min       -33.3%
    Facial movement 0.31       0.22        -29.0%
    """
    baseline_sample = {
        "f0": 145.0,
        "pitch_variability": 18.0,
        "speech_rate": 128.0,
        "average_pause_duration": 0.8,
        "pause_frequency": 10.0,
        "vocal_energy": 0.08,
        "jitter": 0.012,
        "mfcc": -4.5,
        "facial_landmark_movement": 0.31,
        "facial_movement_intensity": 2.8,
        "head_movement": 12.0,
        "blink_rate": 15.0,
        "mouth_movement": 0.22,
    }
    baseline = calculate_baseline([baseline_sample], duration_seconds=45.0)

    interview = {
        "f0": 172.0,
        "pitch_variability": 22.0,
        "speech_rate": 151.0,
        "average_pause_duration": 1.3,
        "pause_frequency": 14.0,
        "vocal_energy": 0.09,
        "jitter": 0.015,
        "mfcc": -4.2,
        "facial_landmark_movement": 0.22,
        "facial_movement_intensity": 2.1,
        "head_movement": 8.0,
        "blink_rate": 18.0,
        "mouth_movement": 0.18,
    }

    result = calculate_deviations(baseline, interview, threshold_percent=15.0)

    # Check the illustrative features match proposal values
    f0_pct = result["features"]["f0"]["percentage_deviation"]
    assert abs(f0_pct - 18.62) < 0.1, f"Expected +18.6%, got {f0_pct}%"

    rate_pct = result["features"]["speech_rate"]["percentage_deviation"]
    assert abs(rate_pct - 17.97) < 0.1, f"Expected +18.0%, got {rate_pct}%"

    pause_pct = result["features"]["average_pause_duration"]["percentage_deviation"]
    assert abs(pause_pct - 62.5) < 0.1, f"Expected +62.5%, got {pause_pct}%"

    head_pct = result["features"]["head_movement"]["percentage_deviation"]
    assert abs(head_pct - (-33.33)) < 0.1, f"Expected -33.3%, got {head_pct}%"

    face_pct = result["features"]["facial_landmark_movement"]["percentage_deviation"]
    assert abs(face_pct - (-29.03)) < 0.1, f"Expected -29.0%, got {face_pct}%"

    assert result["overall_status"] == "behavioral_deviation_detected"
    assert "pds" in result
    assert result["pds"]["vocal"] > 0
    assert result["pds"]["facial"] > 0
    assert result["pds"]["multimodal"] > 0


def test_fastapi_endpoints():
    """Verify FastAPI endpoints execute with 200 OK."""
    client = TestClient(app)

    # 1. Health
    h = client.get("/health")
    assert h.status_code == 200
    assert h.json()["pp1_scope_completed"] == "50%"

    # 2. Extract vocal from samples
    samples = [0.05 * np.sin(2 * np.pi * 150 * i / 16000) for i in range(16000)]
    v_res = client.post(
        "/api/c1/vocal/extract-from-samples",
        json={"samples": samples, "sample_rate": 16000},
    )
    assert v_res.status_code == 200
    assert "f0" in v_res.json()["features"]

    # 3. Baseline calibrate
    base_res = client.post(
        "/api/c1/baseline/calibrate",
        json={"samples": [{"f0": 150.0, "speech_rate": 130.0}], "duration_seconds": 40.0},
    )
    assert base_res.status_code == 200
    assert base_res.json()["baseline"]["duration_status"] == "valid_duration"


if __name__ == "__main__":
    print("Testing vocal features (8 features)...")
    test_vocal_features_count_and_types()
    print("[OK] Vocal features OK")

    print("Testing facial features (5 features)...")
    test_facial_features_count_and_types()
    print("[OK] Facial features OK")

    print("Testing baseline calibration (30-60s window)...")
    test_baseline_calibration_and_window()
    print("[OK] Baseline calibration OK")

    print("Testing proposal illustrative benchmark case...")
    test_illustrative_proposal_benchmark()
    print("[OK] Proposal benchmark matching illustrative numbers OK")

    print("Testing FastAPI backend endpoints...")
    test_fastapi_endpoints()
    print("[OK] FastAPI endpoints OK")

    print("\n------------------------------------------------------------")
    print("SUCCESS: 100% of Component 1 PP1 Scope validated successfully!")
    print("------------------------------------------------------------")
