import { chatCompletion, MODELS } from '../llm/groqClient.js';
import { storeFacts } from './factStore.js';
import { logger } from '../utils/logger.js';

const SYSTEM_PROMPT = `You extract durable facts worth remembering long-term from a single chat exchange \
(e.g. the user's projects, goals, preferences, decisions). Ignore small talk or one-off questions.
Reply with ONLY a JSON array, no prose. Each item: {"content": string, "project": string|null}.
If nothing is worth remembering, reply with [].`;

export async function extractAndStoreFacts({ userId, userMessage, assistantReply, sourceMessageId }) {
  try {
    const raw = await chatCompletion({
      model: MODELS.fast,
      temperature: 0,
      maxTokens: 300,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `User: ${userMessage}\nAssistant: ${assistantReply}` },
      ],
    });

    const facts = JSON.parse(raw);
    if (Array.isArray(facts) && facts.length) {
      await storeFacts({ userId, facts, sourceMessageId });
    }
  } catch (err) {
    // Fact extraction is best-effort — never fail the user-facing request over it.
    logger.warn('fact extraction skipped:', err.message);
  }
}
