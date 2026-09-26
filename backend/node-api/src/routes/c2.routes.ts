import { Router } from 'express';
import { z } from 'zod';
import { callPython } from '../services/pythonClient.js';

export const router = Router();
const questionSchema = z.object({ question: z.string().min(1), answer: z.string().min(1) });

router.post('/score', async (request, response) => {
  const result = questionSchema.safeParse(request.body);
  if (!result.success) return response.status(400).json({ error: result.error.flatten() });
  try {
    return response.json(await callPython('/api/c2/score', result.data));
  } catch (error) {
    return response.status(502).json({ error: (error as Error).message });
  }
});
