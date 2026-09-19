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
import { callCodeRunner } from '../llm/codeRunnerClient.js';
import { logger } from '../utils/logger.js';

export const chatRouter = Router();

const TEXT_EXTENSIONS = new Set(['csv', 'txt', 'json', 'md']);

function extOf(filename) {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

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
    const isNewConversation = !bodyConversationId;
    const conversationId = bodyConversationId || (await createConversation(userId, project));

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

    // Images go straight to the agent as vision content. Non-image files
    // (csv/xlsx/pdf/etc) land in the sandbox workspace for the dev agent's
    // existing tools to inspect — only dev has sandbox access, so route
    // there directly rather than risk the classifier missing the signal.
    const images = [];
    const uploadedFilenames = [];
    let forceDevAgent = false;

    for (const att of attachments) {
      if (!att || typeof att.filename !== 'string' || typeof att.dataBase64 !== 'string') continue;
      const mimeType = typeof att.mimeType === 'string' ? att.mimeType : 'application/octet-stream';

      if (mimeType.startsWith('image/')) {
        images.push(`data:${mimeType};base64,${att.dataBase64}`);
        continue;
      }

      forceDevAgent = true;
      uploadedFilenames.push(att.filename);
      try {
        const isText = TEXT_EXTENSIONS.has(extOf(att.filename));
        await callCodeRunner({
          action: 'write_file',
          language: 'python',
          path: `uploads/${att.filename}`,
          content: isText ? Buffer.from(att.dataBase64, 'base64').toString('utf8') : att.dataBase64,
          encoding: isText ? undefined : 'base64',
          userId,
          project,
        });
      } catch (err) {
        logger.warn(`failed to stage upload ${att.filename}:`, err.message);
      }
    }

    let agentName;
    let raw;
    if (forceDevAgent) {
      agentName = 'dev';
      raw = '(forced: non-image attachment)';
    } else {
      ({ agent: agentName, raw } = await classify(message));
    }
    await logRouting({ messageId: userMessageId, classifiedAgent: agentName, rawModelOutput: raw });

    const agentCtx = {
      userId,
      project,
      conversationId,
      message: uploadedFilenames.length
        ? `${message}\n\n(Uploaded file${uploadedFilenames.length > 1 ? 's' : ''} available at ${uploadedFilenames.map((f) => `uploads/${f}`).join(', ')} in your sandbox workspace.)`
        : message,
      history,
      relevantFacts,
      images: images.length ? images : undefined,
      generatedImages: [],
    };

    const agent = agents[agentName];
    const { reply } = await agent.handle(agentCtx);

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

    const response = { conversation_id: conversationId, agent: agentName, reply };
    if (agentCtx.generatedImages.length) response.images = agentCtx.generatedImages;
    res.json(response);
  } catch (err) {
    logger.error('chat request failed:', err);
    res.status(500).json({ error: 'internal error' });
  }
});
