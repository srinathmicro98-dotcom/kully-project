import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { chatRouter } from './routes/chat.js';
import { logger } from './utils/logger.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use(healthRouter);
app.use(chatRouter);

app.listen(config.port, '127.0.0.1', () => {
  logger.info(`Kully orchestrator listening on 127.0.0.1:${config.port}`);
});
