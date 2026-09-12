import jwt from 'jsonwebtoken';
import { config } from '../config.js';

// Tokens are issued by the control-plane Lambda (which owns login), not here —
// this just verifies them, using the same JWT_SECRET both sides are configured with.
export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}
