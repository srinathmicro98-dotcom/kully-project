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
import { toolsRouter } from './routes/tools.js';
import { artifactsRouter } from './routes/artifacts.js';
import { factsRouter } from './routes/facts.js';
import { voiceRouter } from './routes/voice.js';
import { requireAuth } from './auth/requireAuth.js';
import { touchActivity } from './activity.js';
import { logger } from './utils/logger.js';

const app = express();

app.use(cors());
// Default (~100kb) is too small for base64 image/file attachments and audio clips.
app.use(express.json({ limit: '10mb' }));

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
app.use(requireAuth, toolsRouter);
app.use(requireAuth, artifactsRouter);
app.use(requireAuth, factsRouter);
app.use(requireAuth, voiceRouter);

app.listen(config.port, '127.0.0.1', () => {
  logger.info(`Kully orchestrator listening on 127.0.0.1:${config.port}`);
});
