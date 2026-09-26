import { agents } from './agents/index.js';
import { classify } from './router.js';
import {
  createConversation,
  setConversationTitle,
  insertMessage,
  getRecentMessages,
  logRouting,
} from '../memory/conversationStore.js';
import { findRelevantFacts } from '../memory/factStore.js';
import { extractAndStoreFacts } from '../memory/factExtractor.js';
import { maybeSummarizeConversation } from '../memory/conversationSummarizer.js';
import { callCodeRunner } from '../llm/codeRunnerClient.js';
import { logger } from '../utils/logger.js';

const TEXT_EXTENSIONS = new Set(['csv', 'txt', 'json', 'md']);

function extOf(filename) {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

/**
 * The full chat pipeline shared by the real `/chat` route and internally-
 * triggered messages (e.g. a scheduled task's prompt) — routing, memory
 * recall/storage, attachments, everything. Both callers get a real
 * conversation in history, not a side-channel.
 */
export async function processChatMessage({ userId, project, conversationId: bodyConversationId, message, attachments = [] }) {
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

  const conversationSummary = await maybeSummarizeConversation({ conversationId, userId });

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
    ({ agent: agentName, raw } = await classify(message, userId));
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
    conversationSummary,
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

  return { conversationId, agent: agentName, reply, images: agentCtx.generatedImages };
}
