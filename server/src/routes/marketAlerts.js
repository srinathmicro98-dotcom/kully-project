import { Router } from 'express';
import { createAlert, listAlerts, setAlertEnabled, deleteAlert } from '../memory/marketAlertStore.js';

export const marketAlertsRouter = Router();

marketAlertsRouter.get('/market-alerts', async (req, res) => {
  const userId = req.query.user_id;
  if (!userId || typeof userId !== 'string') return res.status(400).json({ error: 'user_id is required' });
  res.json(await listAlerts(userId));
});

marketAlertsRouter.post('/market-alerts', async (req, res) => {
  const { user_id: userId, project, symbol, indicator, comparator, threshold } = req.body ?? {};
  if (!userId || typeof userId !== 'string') return res.status(400).json({ error: 'user_id is required' });
  if (!symbol || typeof symbol !== 'string') return res.status(400).json({ error: 'symbol is required' });
  if (!['price', 'rsi14'].includes(indicator)) return res.status(400).json({ error: 'indicator must be "price" or "rsi14"' });
  if (!['above', 'below'].includes(comparator)) return res.status(400).json({ error: 'comparator must be "above" or "below"' });
  if (typeof threshold !== 'number' || Number.isNaN(threshold)) return res.status(400).json({ error: 'threshold must be a number' });

  const alert = await createAlert({ userId, project, symbol, indicator, comparator, threshold });
  res.json(alert);
});

marketAlertsRouter.put('/market-alerts/:id', async (req, res) => {
  const { user_id: userId, enabled } = req.body ?? {};
  if (!userId || typeof userId !== 'string') return res.status(400).json({ error: 'user_id is required' });
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean' });
  await setAlertEnabled({ id: req.params.id, userId, enabled });
  res.json({ ok: true });
});

marketAlertsRouter.delete('/market-alerts/:id', async (req, res) => {
  const userId = req.query.user_id;
  if (!userId || typeof userId !== 'string') return res.status(400).json({ error: 'user_id is required' });
  await deleteAlert({ id: req.params.id, userId });
  res.json({ ok: true });
});
