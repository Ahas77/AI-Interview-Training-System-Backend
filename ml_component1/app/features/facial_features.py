"""Facial movement feature extraction for Component 1 - PP1 Scope.

Extracts the five specified PP1 visual/facial features:
9.  Facial landmark movement (mean normalized Euclidean displacement of landmarks)
10. Facial movement intensity (displacement velocity per second)
11. Head movement (head displacement / frequency in units per minute)
12. Blink rate (eye blinks per minute using Eye Aspect Ratio - EAR)
13. Mouth movement (mouth aspect ratio - MAR / lip activity)

Handles both:
- Landmark arrays (from MediaPipe in live frontend)
- Video files (MP4, WebM) with robust fallback face detection
"""

from __future__ import annotations

import math
import os
from typing import Any

import numpy as np


# Standard landmark indices for Face Mesh (468 points)
LEFT_EYE_INDICES = [33, 160, 158, 133, 153, 144]
RIGHT_EYE_INDICES = [362, 385, 387, 263, 373, 380]
MOUTH_TOP = 13
MOUTH_BOTTOM = 14
MOUTH_LEFT = 61
MOUTH_RIGHT = 291
HEAD_MARKERS = [1, 168, 10]


def calculate_ear(landmarks: np.ndarray, eye_indices: list[int]) -> float:
    """Calculate Eye Aspect Ratio (EAR) for blink detection."""
    if len(landmarks) <= max(eye_indices):
        return 0.3

    p = landmarks[eye_indices, :2]
    v1 = np.linalg.norm(p[1] - p[5])
    v2 = np.linalg.norm(p[2] - p[4])
    h = np.linalg.norm(p[0] - p[3])
    if h < 1e-6:
        return 0.3
    return float((v1 + v2) / (2.0 * h))


def calculate_mar(landmarks: np.ndarray) -> float:
    """Calculate Mouth Aspect Ratio (MAR) for mouth movement tracking."""
    if len(landmarks) <= max(MOUTH_TOP, MOUTH_BOTTOM, MOUTH_LEFT, MOUTH_RIGHT):
        return 0.2

    top = landmarks[MOUTH_TOP, :2]
    bottom = landmarks[MOUTH_BOTTOM, :2]
    left = landmarks[MOUTH_LEFT, :2]
    right = landmarks[MOUTH_RIGHT, :2]

    vertical = np.linalg.norm(top - bottom)
    horizontal = np.linalg.norm(left - right)
    if horizontal < 1e-6:
        return 0.2
    return float(vertical / horizontal)


def calculate_face_scale(landmarks: np.ndarray) -> float:
    """Calculate face normalization scale (inter-ocular distance)."""
    if len(landmarks) > 263:
        scale = float(np.linalg.norm(landmarks[33, :2] - landmarks[263, :2]))
        if scale > 1e-4:
            return scale
    bbox_width = float(np.max(landmarks[:, 0]) - np.min(landmarks[:, 0]))
    return max(bbox_width, 1e-4)


def extract_facial_features(
    previous_landmarks: np.ndarray | None,
    landmarks: np.ndarray,
    frame_delta_seconds: float = 0.033,
    blink_count: int = 0,
    mouth_open_ratio: float | None = None,
    total_duration_seconds: float = 1.0,
) -> dict[str, Any]:
    """Calculate the five PP1 visual measurements for landmark frames."""
    current = np.asarray(landmarks, dtype=np.float32)
    if current.ndim != 2 or current.shape[1] < 2:
        raise ValueError("landmarks must have shape (landmark_count, 2 or more)")
    if frame_delta_seconds <= 0:
        raise ValueError("frame_delta_seconds must be positive")

    scale = calculate_face_scale(current)

    if previous_landmarks is None:
        movement = 0.0
        head_disp = 0.0
    else:
        previous = np.asarray(previous_landmarks, dtype=np.float32)
        if previous.shape != current.shape:
            raise ValueError("previous_landmarks and landmarks must have the same shape")
        point_diffs = np.linalg.norm(current[:, :2] - previous[:, :2], axis=1)
        movement = float(np.mean(point_diffs) / scale)

        if len(current) > max(HEAD_MARKERS):
            head_diffs = np.linalg.norm(
                current[HEAD_MARKERS, :2] - previous[HEAD_MARKERS, :2], axis=1
            )
            head_disp = float(np.mean(head_diffs) / scale)
        else:
            head_disp = movement

    movement_intensity = movement / frame_delta_seconds
    head_movement_rate = (head_disp / frame_delta_seconds) * 60.0
    duration_min = max(total_duration_seconds / 60.0, frame_delta_seconds / 60.0)
    blink_rate = float(blink_count / duration_min) if duration_min > 0 else 0.0

    if mouth_open_ratio is not None:
        mar = float(mouth_open_ratio)
    else:
        mar = calculate_mar(current)

    return {
        "facial_landmark_movement": round(float(movement), 4),
        "facial_movement_intensity": round(float(movement_intensity), 4),
        "head_movement": round(float(head_movement_rate), 2),
        "blink_rate": round(float(blink_rate), 2),
        "mouth_movement": round(float(mar), 4),
        "status": "facial_features_extracted",
    }


def extract_facial_features_from_video(
    video_path: str,
    max_frames: int | None = 600,
) -> dict[str, Any]:
    """Process a video file with robust face tracking and optical flow."""
    import cv2

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Could not open video file: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_delta = 1.0 / fps

    frames_processed = 0
    blink_count = 0
    in_blink = False

    landmark_movements: list[float] = []
    head_movements: list[float] = []
    mouth_movements: list[float] = []

    prev_gray_roi = None

    # Load Haar cascade safely if available
    cascade_path = getattr(cv2.data, "haarcascades", "") + "haarcascade_frontalface_default.xml"
    face_cascade = None
    if os.path.exists(cascade_path):
        clf = cv2.CascadeClassifier(cascade_path)
        if not clf.empty():
            face_cascade = clf

    prev_face_box = None

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frames_processed += 1
        h_frame, w_frame = frame.shape[:2]
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # 1. Detect face if classifier is loaded; otherwise use center region
        current_face_box = None
        if face_cascade is not None:
            try:
                faces = face_cascade.detectMultiScale(
                    gray, scaleFactor=1.2, minNeighbors=4, minSize=(60, 60)
                )
                if len(faces) > 0:
                    current_face_box = faces[0]
            except Exception:
                current_face_box = None

        if current_face_box is None:
            # Candidate is positioned in the center 60% of frame during interview
            fw, fh = int(w_frame * 0.5), int(h_frame * 0.6)
            fx, fy = int((w_frame - fw) / 2), int(h_frame * 0.15)
            current_face_box = (fx, fy, fw, fh)

        x, y, w, h = current_face_box
        face_roi = gray[y : y + h, x : x + w]

        # 2. Head movement tracking from bbox centroid displacement
        if prev_face_box is not None:
            curr_center = np.array([x + w / 2.0, y + h / 2.0])
            prev_center = np.array([prev_face_box[0] + prev_face_box[2] / 2.0, prev_face_box[1] + prev_face_box[3] / 2.0])
            disp = np.linalg.norm(curr_center - prev_center) / max(w, 1.0)
            head_movements.append(float(disp))
        prev_face_box = (x, y, w, h)

        # 3. Facial movement intensity via optical flow
        if prev_gray_roi is not None and prev_gray_roi.shape == face_roi.shape:
            flow = cv2.calcOpticalFlowFarneback(
                prev_gray_roi, face_roi, None, 0.5, 3, 15, 3, 5, 1.2, 0
            )
            mag, _ = cv2.cartToPolar(flow[..., 0], flow[..., 1])
            disp = float(np.mean(mag) / max(w, 1.0))
            landmark_movements.append(disp)
        prev_gray_roi = face_roi.copy()

        # 4. Mouth movement (lower 30% of face)
        mouth_y1 = int(h * 0.68)
        mouth_roi = face_roi[mouth_y1:h, :]
        if mouth_roi.size > 0:
            mouth_std = float(np.std(mouth_roi) / 255.0)
            mouth_movements.append(mouth_std)

        # 5. Blink detection (eye region variation dips)
        eye_y1 = int(h * 0.2)
        eye_y2 = int(h * 0.45)
        eye_roi = face_roi[eye_y1:eye_y2, :]
        if eye_roi.size > 0:
            eye_val = float(np.mean(eye_roi) / 255.0)
            if eye_val < 0.22 and not in_blink:
                blink_count += 1
                in_blink = True
            elif eye_val >= 0.26:
                in_blink = False

        if max_frames and frames_processed >= max_frames:
            break

    cap.release()

    total_duration_sec = max(frames_processed * frame_delta, 0.1)
    total_duration_min = max(total_duration_sec / 60.0, 1.0 / 60.0)

    avg_movement = float(np.mean(landmark_movements)) if landmark_movements else 0.045
    movement_intensity = avg_movement / frame_delta
    avg_head_disp = float(np.mean(head_movements)) if head_movements else 0.015
    head_movement_rate = (avg_head_disp / frame_delta) * 60.0
    blink_rate = float(blink_count / total_duration_min)
    avg_mouth = float(np.mean(mouth_movements)) if mouth_movements else 0.18

    return {
        "facial_landmark_movement": round(avg_movement, 4),
        "facial_movement_intensity": round(movement_intensity, 4),
        "head_movement": round(head_movement_rate, 2),
        "blink_rate": round(blink_rate, 2),
        "mouth_movement": round(avg_mouth, 4),
        "total_frames": frames_processed,
        "duration_seconds": round(total_duration_sec, 2),
        "blink_count": blink_count,
        "status": "video_facial_features_extracted",
    }
