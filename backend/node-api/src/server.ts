import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { router as c1Router } from './routes/c1.routes.js';
import { router as c2Router } from './routes/c2.routes.js';
import { router as c3Router } from './routes/c3.routes.js';
import { router as c4Router } from './routes/c4.routes.js';

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.get('/health', (_request, response) => response.json({ status: 'ok', service: 'node-api' }));
app.use('/api/c1', c1Router);
app.use('/api/c2', c2Router);
app.use('/api/c3', c3Router);
app.use('/api/c4', c4Router);

app.listen(port, () => {
  console.log(`Node API listening on http://localhost:${port}`);
});
