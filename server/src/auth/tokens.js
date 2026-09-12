import jwt from 'jsonwebtoken';
import { config } from '../config.js';

const EXPIRES_IN = '30d';

export function issueToken() {
  return jwt.sign({ sub: config.authUsername }, config.jwtSecret, { expiresIn: EXPIRES_IN });
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}
