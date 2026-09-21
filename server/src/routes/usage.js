import { Router } from 'express';
import { getUsageSummary } from '../memory/usageStore.js';

export const usageRouter = Router();

usageRouter.get('/usage/summary', async (req, res) => {
  const userId = req.query.user_id;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'user_id is required' });
  }
  const sinceDays = Number(req.query.since_days) || 30;
  res.json(await getUsageSummary({ userId, sinceDays }));
});
