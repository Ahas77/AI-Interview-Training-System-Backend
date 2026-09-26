# Multimodal Explainable AI Interview Coaching Backend

Backend scaffold for a multimodal, explainable, emotion-aware interview coaching system.

## Structure

- `backend/node-api`: TypeScript + Express public API and orchestration layer.
- `backend/python-ai`: FastAPI model service, feature extraction, fusion, research models, and evaluation.
- `backend/docs`: service contracts and architecture notes.
- `backend/tests`: Python smoke tests and endpoint checks.

## Run the services

Start the Python AI service:

```powershell
Set-Location backend/python-ai
..\.\.venv\Scripts\python.exe -m pip install -r requirements.txt
..\.\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
```

In a second terminal, start the Node API:

```powershell
Set-Location backend/node-api
npm install
Copy-Item .env.example .env
npm run dev
```

The public API runs at `http://localhost:4000`; the AI service runs at `http://localhost:8000`.

The commands use the repository-level `.venv`. Create it with `py -3.14 -m venv .venv` if it does not exist.

## Components

- C1: baseline analysis.
- C2: interview question scoring.
- C3: coaching signals and feedback.
- C4: synthetic data and model benchmarking.

The model and dataset files are intentionally placeholders until the research implementation and trained weights are added.

Research-only numeric libraries are listed separately in `backend/python-ai/requirements-research.txt` because they require additional disk space.