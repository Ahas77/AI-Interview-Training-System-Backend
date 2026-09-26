# API contracts

## Services

- Node API: `http://localhost:4000`
- Python AI: `http://localhost:8000`

The Node API owns public workflow endpoints and forwards model-specific work to the Python AI service. The Python service owns feature extraction, inference, explanation evidence, and research model execution.
