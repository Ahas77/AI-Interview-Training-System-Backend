import { Router } from 'express';

export const router = Router();
router.get('/sessions', (_request, response) => response.json({ sessions: [] }));
router.post('/feedback', (_request, response) => response.status(501).json({ error: 'Coaching feedback is not configured yet' }));
