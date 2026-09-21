import { chatCompletion, MODELS } from '../llm/groqClient.js';
import {
  countMessages,
  getConversationSummary,
  setConversationSummary,
  getMessagesForSummary,
} from './conversationStore.js';
import { logger } from '../utils/logger.js';

const SUMMARIZE_AFTER = 20; // don't bother until the conversation is genuinely long
const RESUMMARIZE_EVERY = 5; // re-run every N messages past that, not every single turn

const SYSTEM_PROMPT = 'Summarize this conversation history into a compact briefing for an AI assistant ' +
  'that will continue it — key facts, decisions, and context, not a transcript. Plain text, no headers, ' +
  'a few sentences to a short paragraph. If given a prior summary, fold it in rather than starting over.';

/**
 * Best-effort: returns the conversation's current summary (generating/
 * refreshing it first if the conversation just crossed a re-summarize
 * threshold), or null if it's short enough not to need one. Never throws —
 * a summarization failure should just mean the model sees plain history.
 */
export async function maybeSummarizeConversation({ conversationId, userId }) {
  try {
    const total = await countMessages(conversationId);
    if (total <= SUMMARIZE_AFTER) return null;

    const existing = await getConversationSummary(conversationId);
    const dueForRefresh = (total - SUMMARIZE_AFTER) % RESUMMARIZE_EVERY === 0;
    if (existing && !dueForRefresh) return existing;

    const older = await getMessagesForSummary(conversationId, 10);
    if (!older.length) return existing;

    const transcript = older.map((m) => `${m.role}: ${m.content}`).join('\n');
    const userContent = existing
      ? `Prior summary:\n${existing}\n\nNewer messages to fold in:\n${transcript}`
      : transcript;

    const summary = await chatCompletion({
      model: MODELS.fast,
      temperature: 0.2,
      maxTokens: 300,
      reasoningEffort: 'low',
      userId,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    });

    if (summary.trim()) {
      await setConversationSummary(conversationId, summary.trim());
      return summary.trim();
    }
    return existing;
  } catch (err) {
    logger.warn('conversation summarization skipped:', err.message);
    return null;
  }
}
