import { chatCompletion, MODELS } from '../../llm/groqClient.js';
import { buildMessages } from './agentInterface.js';
import { getSystemPrompt } from '../../memory/agentConfigStore.js';

export const name = 'general';

export const DEFAULT_SYSTEM_PROMPT = `You are the general reasoning/conversation specialist on the user's AI \
cofounder team. Handle everyday questions, brainstorming, planning, and anything that isn't a \
coding task or a request for current/live information. Be direct and conversational. \
You have NO code execution, file access, or skills tools — only the dev agent does. If a request needs \
those (running code, reading/writing a file, or a named skill's real instructions), say plainly that you \
can't do that here and suggest asking again as a dev/coding question — never invent a plausible-sounding \
result for something you didn't actually do.`;

/** @type {import('./agentInterface.js').AgentHandler} */
export async function handle(ctx) {
  const systemPrompt = await getSystemPrompt(name, DEFAULT_SYSTEM_PROMPT);
  const messages = buildMessages({ systemPrompt, ctx });
  const reply = await chatCompletion({ model: MODELS.smart, messages, temperature: 0.7 });
  return { reply };
}
