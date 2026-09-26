def evaluate_predictions(actual: list[float], predicted: list[float]) -> dict[str, float]:
    if not actual or len(actual) != len(predicted):
        return {"mae": 0.0}
    error = sum(abs(left - right) for left, right in zip(actual, predicted)) / len(actual)
    return {"mae": error}
