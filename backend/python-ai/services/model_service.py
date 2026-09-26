class ModelService:
    """Application boundary for loading and invoking trained models."""

    def predict(self, features: dict[str, object]) -> dict[str, object]:
        return {"features": features, "prediction": None}
