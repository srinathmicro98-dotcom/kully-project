import { chatCompletion, MODELS } from '../llm/groqClient.js';
import { agentNames } from './agents/index.js';

const SYSTEM_PROMPT = `Classify the user's message into exactly one label: ${agentNames.join(', ')}.
- dev: coding, debugging, architecture, technical build questions — including anything that implies \
running code, reading/writing a file, executing a shell command, or invoking a named skill (only the \
dev agent has those tools). If the message mentions a filename, a function, a stack trace, "run"/"test"/ \
"debug"/"refactor" something, or references a skill by name, that's dev, even if it's also asking for an \
explanation.
- search: needs current/live information (news, prices, "latest", real-time facts).
- general: everything else (conversation, planning, brainstorming, advice) — NOT tasks that need actual \
code execution or file access, even if phrased conversationally.
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
