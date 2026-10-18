"""Inspect RecruitView without downloading the complete video corpus."""

import argparse
from itertools import islice

from datasets import Video, load_dataset
from datasets.exceptions import DatasetNotFoundError

DATASET_ID = "AI4A-lab/RecruitView"


def inspect_dataset(sample_count: int = 1) -> None:
    try:
        # Streaming reads metadata and fetches only records that are iterated.
        # This is important for video datasets on machines with limited storage.
        dataset = load_dataset(DATASET_ID, streaming=True)
    except DatasetNotFoundError as error:
        raise SystemExit(
            f"{DATASET_ID} is gated or unavailable. Request access on Hugging Face, "
            "then authenticate with `hf auth login` before running this command again."
        ) from error
    print("Dataset splits:", list(dataset.keys()))
    for split_name, split in dataset.items():
        # Metadata inspection should not require torchcodec or FFmpeg.
        # Video decoding is deferred to feature extraction.
        if "video" in split.column_names:
            split = split.cast_column("video", Video(decode=False))
        print(f"\n--- {split_name} ---")
        print("Columns:", split.column_names)
        print("Features:", split.features)
        for record_number, example in enumerate(islice(split, sample_count), start=1):
            print(f"Sample {record_number}:")
            for key, value in example.items():
                if isinstance(value, dict):
                    summary = {name: type(item).__name__ for name, item in value.items()}
                else:
                    summary = type(value).__name__
                print(f"  {key}: {summary}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=int, default=1, help="Records to inspect per split.")
    args = parser.parse_args()
    if args.samples < 0:
        parser.error("--samples must be zero or greater")
    inspect_dataset(sample_count=args.samples)
