from export.dataset import export_dataset


def test_export_dataset_preserves_rows() -> None:
    rows = [{"score": 1}]
    assert export_dataset(rows) == rows
