"""Facial movement feature extraction for Component 1.

MediaPipe is loaded lazily so the calibration API can run with numeric feature
payloads even when camera processing dependencies are unavailable.
"""

from __future__ import annotations

from typing import Any

import numpy as np


def extract_facial_features(
    previous_landmarks: np.ndarray | None,
    landmarks: np.ndarray,
    frame_delta_seconds: float,
    blink_count: int = 0,
    mouth_open_ratio: float | None = None,
) -> dict[str, Any]:
    """Calculate five interpretable visual measurements for one frame."""
    current = np.asarray(landmarks, dtype=np.float32)
    if current.ndim != 2 or current.shape[1] < 2:
        raise ValueError("landmarks must have shape (landmark_count, 2 or more)")
    if frame_delta_seconds <= 0:
        raise ValueError("frame_delta_seconds must be positive")

    if previous_landmarks is None:
        movement = 0.0
    else:
        previous = np.asarray(previous_landmarks, dtype=np.float32)
        if previous.shape != current.shape:
            raise ValueError("previous_landmarks and landmarks must have the same shape")
        movement = float(np.mean(np.linalg.norm(current[:, :2] - previous[:, :2], axis=1)))

    return {
        "facial_landmark_movement": movement,
        "facial_movement_intensity": movement / frame_delta_seconds,
        "head_movement": movement,
        "blink_rate": float(blink_count) / frame_delta_seconds * 60,
        "mouth_movement": float(mouth_open_ratio) if mouth_open_ratio is not None else None,
    }
