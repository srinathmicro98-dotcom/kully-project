import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { issueToken } from '../auth/tokens.js';
import { requireAuth } from '../auth/requireAuth.js';

export const authRouter = Router();

// Single-user sign-in only — there is deliberately no signup endpoint.
authRouter.post('/auth/login', async (req, res) => {
  const { username, password } = req.body ?? {};

  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const validUsername = username === config.authUsername;
  const validPassword = await bcrypt.compare(password, config.authPasswordHash);

  if (!validUsername || !validPassword) {
    return res.status(401).json({ error: 'invalid credentials' });
  }

  res.json({ token: issueToken() });
});

authRouter.get('/auth/verify', requireAuth, (_req, res) => {
  res.json({ ok: true });
});
