"""Training placeholder.

Do not train until prepare_dataset.py confirms valid audio/video inputs and
participant-level labels. Component 1 PP1 is useful without a supervised model:
the personalized baseline and deviation engine is the first validated artifact.
"""


def train_model() -> None:
    raise RuntimeError(
        "Training is intentionally not enabled yet. Inspect RecruitView and define "
        "participant-level labels before training to avoid invalid conclusions."
    )


if __name__ == "__main__":
    train_model()
