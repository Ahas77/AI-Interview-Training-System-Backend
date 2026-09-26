def extract_audio_features(samples: list[float]) -> dict[str, float]:
    return {"sample_count": float(len(samples))}
