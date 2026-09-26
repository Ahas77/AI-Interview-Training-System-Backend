import { Router } from 'express';

export const router = Router();
router.post('/jobs', (_request, response) => response.status(501).json({ error: 'Synthetic job processing is not configured yet' }));
router.get('/jobs/:id', (request, response) => response.json({ id: request.params.id, status: 'queued' }));
