import { chatCompletion, MODELS } from '../llm/groqClient.js';
import { agentNames } from './agents/index.js';

const SYSTEM_PROMPT = `Classify the user's message into exactly one label: ${agentNames.join(', ')}.
- dev: coding, debugging, architecture, technical build questions — including anything that implies \
running code, reading/writing a file, executing a shell command, or invoking a named skill (only the \
dev agent has those tools). If the message mentions a filename, a function, a stack trace, "run"/"test"/ \
"debug"/"refactor" something, or references a skill by name, that's dev, even if it's also asking for an \
explanation.
- trading: stocks, NSE/BSE tickers, charts, technical indicators, "buy"/"sell" a stock, market analysis — \
even though this involves current prices, it's its own label, not search.
- video: YouTube content — scripts, thumbnails, channel analytics/views, upload, growth/trend research for a channel.
- search: needs current/live information from the EXTERNAL web (news, "latest", real-time facts) that ISN'T \
market/trading data or YouTube content (those have their own labels above). \
NOT for recalling the user's own past notes/decisions/projects — "search across my projects" or "did I \
decide this before" is about the user's own remembered facts, not the live web, so that's general, not search.
- general: everything else (conversation, planning, brainstorming, advice, recalling the user's own past \
notes/decisions across their projects) — NOT tasks that need actual code execution or file access, even if \
phrased conversationally.
Reply with only the single label word, nothing else.`;

/**
 * @returns {Promise<{agent: string, raw: string}>}
 */
export async function classify(message, userId) {
  const raw = await chatCompletion({
    model: MODELS.fast,
    temperature: 0,
    maxTokens: 60,
    reasoningEffort: 'low',
    userId,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: message },
    ],
  });

  const label = raw.trim().toLowerCase();
  const agent = agentNames.includes(label) ? label : 'general';
  return { agent, raw };
}
