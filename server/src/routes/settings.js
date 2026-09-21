import { Router } from 'express';
import { getSetting, setSetting } from '../memory/settingsStore.js';

export const settingsRouter = Router();

const KNOWN_KEYS = new Set(['response_style']);

settingsRouter.get('/settings/response_style', async (_req, res) => {
  try {
    res.json({ value: await getSetting('response_style', 'concise') });
  } catch (err) {
    res.status(503).json({ error: `settings unavailable: ${err.message}` });
  }
});

settingsRouter.put('/settings/:key', async (req, res) => {
  const { key } = req.params;
  const { value } = req.body ?? {};
  if (!KNOWN_KEYS.has(key)) return res.status(404).json({ error: 'unknown setting' });
  if (typeof value !== 'string') return res.status(400).json({ error: 'value must be a string' });
  await setSetting(key, value);
  res.json({ ok: true });
});
