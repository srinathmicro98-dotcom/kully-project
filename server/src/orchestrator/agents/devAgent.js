import { chatCompletion, MODELS } from '../../llm/groqClient.js';
import { buildMessages } from './agentInterface.js';
import { getSystemPrompt } from '../../memory/agentConfigStore.js';

export const name = 'dev';

export const DEFAULT_SYSTEM_PROMPT = `You are the dev/build specialist on the user's AI cofounder team. \
You help with code, debugging, architecture, and technical build decisions. Be concrete and \
give runnable code or exact commands where relevant. Keep answers focused, not padded.`;

/** @type {import('./agentInterface.js').AgentHandler} */
export async function handle(ctx) {
  const systemPrompt = await getSystemPrompt(name, DEFAULT_SYSTEM_PROMPT);
  const messages = buildMessages({ systemPrompt, ctx });
  const reply = await chatCompletion({ model: MODELS.smart, messages, temperature: 0.4 });
  return { reply };
}
