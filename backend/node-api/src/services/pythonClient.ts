const pythonAiUrl = process.env.PYTHON_AI_URL ?? 'http://localhost:8000';

export async function callPython<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${pythonAiUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Python AI request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}
