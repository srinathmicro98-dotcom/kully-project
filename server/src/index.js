import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { internalRouter } from './routes/internal.js';
import { chatRouter } from './routes/chat.js';
import { conversationsRouter } from './routes/conversations.js';
import { agentsRouter } from './routes/agents.js';
import { skillsRouter } from './routes/skills.js';
import { projectsRouter } from './routes/projects.js';
import { requireAuth } from './auth/requireAuth.js';
import { touchActivity } from './activity.js';
import { logger } from './utils/logger.js';

const app = express();

app.use(cors());
app.use(express.json());

// Anything except health checks and the Lambda's own idle-check counts as
// "this box is in use" for the auto-stop timer.
app.use((req, _res, next) => {
  if (req.path !== '/health' && !req.path.startsWith('/internal')) touchActivity();
  next();
});

app.use(healthRouter);
app.use(internalRouter);
app.use(requireAuth, chatRouter);
app.use(requireAuth, conversationsRouter);
app.use(requireAuth, agentsRouter);
app.use(requireAuth, skillsRouter);
app.use(requireAuth, projectsRouter);

app.listen(config.port, '127.0.0.1', () => {
  logger.info(`Kully orchestrator listening on 127.0.0.1:${config.port}`);
});
