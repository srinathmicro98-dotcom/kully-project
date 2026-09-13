import { Router } from 'express';
import { listAllSkills, upsertSkill, deleteSkill } from '../memory/skillStore.js';

export const skillsRouter = Router();

skillsRouter.get('/skills', async (_req, res) => {
  res.json(await listAllSkills());
});

skillsRouter.put('/skills/:name', async (req, res) => {
  const { name } = req.params;
  const { description, body } = req.body ?? {};

  if (!description || typeof description !== 'string' || !body || typeof body !== 'string') {
    return res.status(400).json({ error: 'description and body are required' });
  }

  await upsertSkill({ name, description, body });
  res.json({ ok: true });
});

skillsRouter.delete('/skills/:name', async (req, res) => {
  await deleteSkill(req.params.name);
  res.json({ ok: true });
});
