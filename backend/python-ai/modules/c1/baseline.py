def build_baseline(transcript: str) -> dict[str, object]:
    words = transcript.split()
    return {
        "word_count": len(words),
        "confidence": 0.0,
        "explanation": ["Baseline model has not been trained yet."],
    }
