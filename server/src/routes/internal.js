import { Router } from 'express';
import { config } from '../config.js';
import { getLastActivityAt } from '../activity.js';
import { processChatMessage } from '../orchestrator/chatPipeline.js';
import { logger } from '../utils/logger.js';

export const internalRouter = Router();

// Both routes below are called only by the control-plane Lambda — a shared
// secret, not a user JWT, since there's no logged-in user on this call path.
internalRouter.get('/internal/last-activity', (req, res) => {
  if (req.get('x-internal-secret') !== config.internalApiSecret) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.json({ lastActivityAt: getLastActivityAt() });
});

// The Lambda already knows which task is due (it queries scheduled_tasks
// directly) — this just runs that prompt through the real chat pipeline so
// it shows up in history/memory exactly like a message the user typed.
internalRouter.post('/internal/run-scheduled-task', async (req, res) => {
  if (req.get('x-internal-secret') !== config.internalApiSecret) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const { user_id: userId, project, prompt } = req.body ?? {};
  if (!userId || !prompt) return res.status(400).json({ error: 'user_id and prompt are required' });

  try {
    const result = await processChatMessage({ userId, project: project || 'default', message: prompt });
    res.json({ reply: result.reply });
  } catch (err) {
    logger.error('scheduled task run failed:', err);
    res.status(500).json({ error: 'internal error' });
  }
});
