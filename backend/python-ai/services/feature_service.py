def extract_text_features(text: str) -> dict[str, float]:
    words = text.split()
    return {
        "word_count": float(len(words)),
        "average_word_length": sum(map(len, words)) / len(words) if words else 0.0,
    }
