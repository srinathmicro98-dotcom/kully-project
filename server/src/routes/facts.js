import { Router } from 'express';
import { addFact, updateFact, deleteFact } from '../memory/factStore.js';

export const factsRouter = Router();

factsRouter.post('/facts', async (req, res) => {
  const { user_id: userId, project, content, fact_type: factType } = req.body ?? {};
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'user_id is required' });
  }
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'content is required' });
  }
  res.json(await addFact({ userId, project, content, factType }));
});

factsRouter.put('/facts/:id', async (req, res) => {
  const { user_id: userId, content, fact_type: factType } = req.body ?? {};
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'user_id is required' });
  }
  await updateFact({ id: req.params.id, userId, content, factType });
  res.json({ ok: true });
});

factsRouter.delete('/facts/:id', async (req, res) => {
  const userId = req.query.user_id;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'user_id is required' });
  }
  await deleteFact({ id: req.params.id, userId });
  res.json({ ok: true });
});
