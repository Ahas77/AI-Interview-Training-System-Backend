# Component 1 models

Generated model files are ignored by Git. The first baseline predicts
`confidence_score` from transcript and non-target metadata. It uses a grouped
train/test split by `user_no` so recordings from one participant do not appear
in both partitions.

From `ml_component1`, train it with:

```powershell
.\.venv\Scripts\python.exe -m app.training.train_model --target confidence_score
```

The command writes `models/recruitview_confidence_score_baseline.joblib` and
the corresponding metrics JSON. This is a baseline, not an emotion model:
video/audio feature extraction and validation of the dataset's label meaning
are required before using it for production coaching decisions. The PP1
calibration API works with a candidate's own baseline and does not require a
trained psychological-state classifier.
