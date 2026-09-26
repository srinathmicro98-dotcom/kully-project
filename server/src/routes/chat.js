import { Router } from 'express';
import { processChatMessage, prepareChatTurn, runChatTurn } from '../orchestrator/chatPipeline.js';
import { notifyPush } from '../llm/pushClient.js';
import { logger } from '../utils/logger.js';

export const chatRouter = Router();

// A background task gets meaningfully more tool-call turns than a normal
// synchronous chat message (which is capped low to keep the caller from
// waiting too long) — there's no HTTP client waiting on this one.
const BACKGROUND_MAX_ITERATIONS = 30;

function readChatBody(body) {
  const {
    user_id: userId,
    conversation_id: bodyConversationId,
    project: rawProject,
    message,
    attachments: rawAttachments,
  } = body ?? {};

  if (!userId || typeof userId !== 'string') return { error: 'user_id is required' };
  if (!message || typeof message !== 'string') return { error: 'message is required' };

  return {
    userId,
    conversationId: bodyConversationId,
    project: typeof rawProject === 'string' && rawProject.trim() ? rawProject.trim() : 'default',
    message,
    attachments: Array.isArray(rawAttachments) ? rawAttachments : [],
  };
}

chatRouter.post('/chat', async (req, res) => {
  const parsed = readChatBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  try {
    const result = await processChatMessage(parsed);
    const response = { conversation_id: result.conversationId, agent: result.agent, reply: result.reply };
    if (result.images?.length) response.images = result.images;
    res.json(response);
  } catch (err) {
    logger.error('chat request failed:', err);
    res.status(500).json({ error: 'internal error' });
  }
});

// Returns as soon as the conversation/routing is set up, then keeps running
// the actual agent turn unawaited — for a task expected to need many tool
// calls (a big multi-file build, a long test-and-fix loop) that would
// otherwise make the caller wait a long time or risk a client-side timeout.
// Completion is delivered as a push notification; the full reply is in
// conversation history whenever the user next opens the app.
chatRouter.post('/chat/background', async (req, res) => {
  const parsed = readChatBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  let prepared;
  try {
    prepared = await prepareChatTurn(parsed);
  } catch (err) {
    logger.error('background chat setup failed:', err);
    return res.status(500).json({ error: 'internal error' });
  }

  res.json({ conversation_id: prepared.conversationId, agent: prepared.agentName, status: 'started' });

  runChatTurn(prepared, { maxIterations: BACKGROUND_MAX_ITERATIONS })
    .then((result) => {
      notifyPush(parsed.userId, 'Kully finished your task', result.reply.slice(0, 180));
    })
    .catch((err) => {
      logger.error('background chat task failed:', err);
      notifyPush(parsed.userId, 'Kully hit a problem', 'Your background task failed — open the app to see what happened.');
    });
});
