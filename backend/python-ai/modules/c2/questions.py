def score_answer(question: str, answer: str) -> dict[str, object]:
    return {
        "question": question,
        "score": 0.0,
        "evidence": ["Question scoring model has not been trained yet."],
        "answer_length": len(answer.split()),
    }
