// Shared by scripts/smoke-test.mjs and scripts/eval-agents.mjs. Signs the
// same shape of JWT the control-plane Lambda issues on login ({ sub:
// username }) so these scripts can hit a running server without a browser.
// Needs JWT_SECRET in the environment — the same value the target server
// (local .env or the EC2 box) is configured with. Never hardcode it here.
import jwt from 'jsonwebtoken';

export function makeTestToken() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set — export the same secret the target server uses (see server/.env).');
  }
  return jwt.sign({ sub: 'default-user' }, secret, { expiresIn: '10m' });
}

// The app is single-user and hardcodes this exact id client-side
// (web/app.js: `userId: 'default-user'`) rather than deriving it from the
// JWT — every request body/query still needs it explicitly.
export const TEST_USER_ID = 'default-user';
