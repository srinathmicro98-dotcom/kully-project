import { Router } from 'express';
import { processChatMessage } from '../orchestrator/chatPipeline.js';
import { logger } from '../utils/logger.js';

export const chatRouter = Router();

chatRouter.post('/chat', async (req, res) => {
  const {
    user_id: userId,
    conversation_id: bodyConversationId,
    project: rawProject,
    message,
    attachments: rawAttachments,
  } = req.body ?? {};

  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'user_id is required' });
  }
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }
  const project = typeof rawProject === 'string' && rawProject.trim() ? rawProject.trim() : 'default';
  const attachments = Array.isArray(rawAttachments) ? rawAttachments : [];

  try {
    const result = await processChatMessage({ userId, project, conversationId: bodyConversationId, message, attachments });
    const response = { conversation_id: result.conversationId, agent: result.agent, reply: result.reply };
    if (result.images?.length) response.images = result.images;
    res.json(response);
  } catch (err) {
    logger.error('chat request failed:', err);
    res.status(500).json({ error: 'internal error' });
  }
});
