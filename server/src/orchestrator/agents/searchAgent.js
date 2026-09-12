import { chatCompletion, MODELS } from '../../llm/groqClient.js';
import { webSearch } from '../../llm/searchClient.js';
import { buildMessages } from './agentInterface.js';
import { logger } from '../../utils/logger.js';

const systemPrompt = `You are the search specialist on the user's AI cofounder team. You are given \
fresh web search results below — use them to answer with current, accurate information, and \
mention sources by name when relevant. If the results don't cover the question, say so.`;

export const name = 'search';

/** @type {import('./agentInterface.js').AgentHandler} */
export async function handle(ctx) {
  let extra;
  try {
    const results = await webSearch(ctx.message);
    extra = results.length
      ? `Web search results:\n${results
          .map((r, i) => `${i + 1}. ${r.title} (${r.url})\n${r.content}`)
          .join('\n\n')}`
      : 'Web search returned no results.';
  } catch (err) {
    logger.warn('web search failed:', err.message);
    extra = 'Web search is currently unavailable — answer from your own knowledge and say so.';
  }

  const messages = buildMessages({ systemPrompt, ctx, extra });
  const reply = await chatCompletion({ model: MODELS.smart, messages, temperature: 0.3 });
  return { reply };
}
