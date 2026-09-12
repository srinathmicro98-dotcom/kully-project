import { chatCompletion, MODELS } from '../llm/groqClient.js';
import { agentNames } from './agents/index.js';

const SYSTEM_PROMPT = `Classify the user's message into exactly one label: ${agentNames.join(', ')}.
- dev: coding, debugging, architecture, technical build questions.
- search: needs current/live information (news, prices, "latest", real-time facts).
- general: everything else (conversation, planning, brainstorming, advice).
Reply with only the single label word, nothing else.`;

/**
 * @returns {Promise<{agent: string, raw: string}>}
 */
export async function classify(message) {
  const raw = await chatCompletion({
    model: MODELS.fast,
    temperature: 0,
    maxTokens: 60,
    reasoningEffort: 'low',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: message },
    ],
  });

  const label = raw.trim().toLowerCase();
  const agent = agentNames.includes(label) ? label : 'general';
  return { agent, raw };
}
