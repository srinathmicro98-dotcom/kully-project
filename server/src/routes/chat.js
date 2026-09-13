import { Router } from 'express';
import { agents } from '../orchestrator/agents/index.js';
import { classify } from '../orchestrator/router.js';
import {
  createConversation,
  setConversationTitle,
  insertMessage,
  getRecentMessages,
  logRouting,
} from '../memory/conversationStore.js';
import { findRelevantFacts } from '../memory/factStore.js';
import { extractAndStoreFacts } from '../memory/factExtractor.js';
import { logger } from '../utils/logger.js';

export const chatRouter = Router();

chatRouter.post('/chat', async (req, res) => {
  const {
    user_id: userId,
    conversation_id: bodyConversationId,
    project: rawProject,
    message,
  } = req.body ?? {};

  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'user_id is required' });
  }
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }
  const project = typeof rawProject === 'string' && rawProject.trim() ? rawProject.trim() : 'default';

  try {
    const isNewConversation = !bodyConversationId;
    const conversationId = bodyConversationId || (await createConversation(userId));

    const userMessageId = await insertMessage({ conversationId, role: 'user', content: message });
    if (isNewConversation) {
      const title = message.length > 40 ? `${message.slice(0, 40)}…` : message;
      await setConversationTitle(conversationId, title);
    }
    const history = await getRecentMessages(conversationId, 10);

    let relevantFacts = [];
    try {
      relevantFacts = await findRelevantFacts({ userId, project, query: message });
    } catch (err) {
      logger.warn('fact recall skipped:', err.message);
    }

    const { agent: agentName, raw } = await classify(message);
    await logRouting({ messageId: userMessageId, classifiedAgent: agentName, rawModelOutput: raw });

    const agent = agents[agentName];
    const { reply } = await agent.handle({
      userId,
      project,
      conversationId,
      message,
      history,
      relevantFacts,
    });

    const assistantMessageId = await insertMessage({
      conversationId,
      role: 'assistant',
      content: reply,
      agent: agentName,
    });

    await extractAndStoreFacts({
      userId,
      project,
      userMessage: message,
      assistantReply: reply,
      sourceMessageId: assistantMessageId,
    });

    res.json({ conversation_id: conversationId, agent: agentName, reply });
  } catch (err) {
    logger.error('chat request failed:', err);
    res.status(500).json({ error: 'internal error' });
  }
});
