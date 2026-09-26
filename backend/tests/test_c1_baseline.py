from modules.c1.baseline import build_baseline


def test_build_baseline_counts_words() -> None:
    result = build_baseline("hello interview coach")
    assert result["word_count"] == 3
