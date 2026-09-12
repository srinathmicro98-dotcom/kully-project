import { verifyToken } from './tokens.js';

export function requireAuth(req, res, next) {
  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized' });
  }
}
