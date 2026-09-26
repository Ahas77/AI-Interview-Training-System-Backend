import { Router } from 'express';
import { z } from 'zod';
import { createJob } from '../services/jobService.js';

export const router = Router();
const baselineSchema = z.object({ candidateId: z.string().optional(), transcript: z.string().min(1) });

router.post('/baseline', (request, response) => {
  const result = baselineSchema.safeParse(request.body);
  if (!result.success) return response.status(400).json({ error: result.error.flatten() });
  return response.status(202).json({ job: createJob(), input: result.data });
});
