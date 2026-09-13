import { Router } from 'express';
import { listProjects } from '../memory/conversationStore.js';
import { listFactsForProject } from '../memory/factStore.js';

export const projectsRouter = Router();

projectsRouter.get('/projects', async (req, res) => {
  const userId = req.query.user_id;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'user_id is required' });
  }
  res.json(await listProjects(userId));
});

projectsRouter.get('/projects/:name/facts', async (req, res) => {
  const userId = req.query.user_id;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'user_id is required' });
  }
  res.json(await listFactsForProject({ userId, project: req.params.name }));
});
