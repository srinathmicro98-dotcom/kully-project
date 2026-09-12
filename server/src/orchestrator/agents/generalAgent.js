import { chatCompletion, MODELS } from '../../llm/groqClient.js';
import { buildMessages } from './agentInterface.js';

const systemPrompt = `You are the general reasoning/conversation specialist on the user's AI \
cofounder team. Handle everyday questions, brainstorming, planning, and anything that isn't a \
coding task or a request for current/live information. Be direct and conversational.`;

export const name = 'general';

/** @type {import('./agentInterface.js').AgentHandler} */
export async function handle(ctx) {
  const messages = buildMessages({ systemPrompt, ctx });
  const reply = await chatCompletion({ model: MODELS.smart, messages, temperature: 0.7 });
  return { reply };
}
