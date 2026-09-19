import { Router } from 'express';
import { listArtifacts, getArtifact } from '../memory/artifactStore.js';

export const artifactsRouter = Router();

artifactsRouter.get('/artifacts', async (req, res) => {
  const userId = req.query.user_id;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'user_id is required' });
  }
  const project = typeof req.query.project === 'string' ? req.query.project : undefined;
  res.json(await listArtifacts({ userId, project }));
});

artifactsRouter.get('/artifacts/:id', async (req, res) => {
  const artifact = await getArtifact(req.params.id);
  if (!artifact) return res.status(404).json({ error: 'not found' });
  res.json(artifact);
});
