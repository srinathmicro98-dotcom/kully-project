import { Router } from 'express';
import { config } from '../config.js';
import { getLastActivityAt } from '../activity.js';

export const internalRouter = Router();

// Called only by the control-plane Lambda's idle-checker — a shared secret,
// not a user JWT, since there's no logged-in user on this call path.
internalRouter.get('/internal/last-activity', (req, res) => {
  if (req.get('x-internal-secret') !== config.internalApiSecret) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.json({ lastActivityAt: getLastActivityAt() });
});
