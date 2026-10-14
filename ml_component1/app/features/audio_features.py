"""Interpretable audio features used by the Component 1 prototype.

The functions operate on mono PCM samples and do not infer psychological state.
They return measurable behavior that can be compared with a candidate baseline.
"""

from __future__ import annotations

from typing import Any

import numpy as np


def _samples(audio: np.ndarray) -> np.ndarray:
    values = np.asarray(audio, dtype=np.float32).reshape(-1)
    if values.size == 0:
        raise ValueError("audio must contain at least one sample")
    return values


def extract_audio_features(audio: np.ndarray, sample_rate: int) -> dict[str, Any]:
    """Extract the eight PP1 vocal features from one audio segment."""
    if sample_rate <= 0:
        raise ValueError("sample_rate must be positive")

    values = _samples(audio)
    rms = float(np.sqrt(np.mean(values**2)))
    zero_crossings = np.diff(np.signbit(values)).astype(np.float32)
    pause_mask = np.abs(values) < max(rms * 0.1, 1e-4)
    pause_frequency = float(np.count_nonzero(np.diff(pause_mask.astype(np.int8)) == 1))
    pause_duration = float(np.mean(pause_mask) * len(values) / sample_rate)

    return {
        "f0": None,
        "pitch_variability": None,
        "speech_rate": None,
        "average_pause_duration": pause_duration,
        "pause_frequency": pause_frequency,
        "vocal_energy": rms,
        "jitter": float(np.std(np.diff(values))) if len(values) > 1 else 0.0,
        "mfcc": None,
        "zero_crossing_rate": float(np.mean(zero_crossings)),
        "sample_rate": sample_rate,
        "status": "baseline_ready_for_pitch_rate_and_mfcc_extractor",
    }


def extract_audio_features_with_librosa(audio: np.ndarray, sample_rate: int) -> dict[str, Any]:
    """Extract pitch and MFCC when librosa is installed and audio is valid."""
    import librosa

    values = _samples(audio)
    pitches, magnitudes = librosa.piptrack(y=values, sr=sample_rate)
    voiced = pitches[magnitudes > np.percentile(magnitudes, 75)]
    f0 = float(np.median(voiced)) if voiced.size else None
    pitch_variability = float(np.std(voiced)) if voiced.size > 1 else None
    mfcc = librosa.feature.mfcc(y=values, sr=sample_rate, n_mfcc=13)
    features = extract_audio_features(values, sample_rate)
    features.update(
        {
            "f0": f0,
            "pitch_variability": pitch_variability,
            "mfcc": float(np.mean(mfcc)),
            "speech_rate": None,
            "status": "pitch_rate_requires_transcript_or_voice_activity_detection",
        }
    )
    return features
