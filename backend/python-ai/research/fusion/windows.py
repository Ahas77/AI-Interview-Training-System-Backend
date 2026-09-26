def align_modal_windows(modalities: dict[str, list[object]], window_seconds: float = 5.0) -> list[dict[str, object]]:
    return [{"window_seconds": window_seconds, "modalities": modalities}]
