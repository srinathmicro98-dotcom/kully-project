import { config } from '../config.js';
import { logger } from '../utils/logger.js';

// Push notifications are actually sent by the control-plane Lambda (it holds
// the VAPID keys and the always-on webpush setup) — this just asks it to,
// over the same shared-secret internal channel used in the other direction.
export async function notifyPush(userId, title, body) {
  try {
    const res = await fetch(`${config.controlPlaneUrl}/internal/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': config.internalApiSecret },
      body: JSON.stringify({ user_id: userId, title, body }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) logger.warn(`push notification failed: status ${res.status}`);
  } catch (err) {
    logger.warn('push notification failed:', err.message);
  }
}
