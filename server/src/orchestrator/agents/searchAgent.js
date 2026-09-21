import { webSearch } from '../../llm/searchClient.js';
import { buildMessages } from './agentInterface.js';
import { runToolLoop } from './toolLoop.js';
import { chatCompletion, MODELS } from '../../llm/groqClient.js';
import { getSystemPrompt } from '../../memory/agentConfigStore.js';
import { SCRAPE_TOOL, handleScrapeTool } from './sharedTools.js';
import { logger } from '../../utils/logger.js';

export const name = 'search';

export const DEFAULT_SYSTEM_PROMPT = `You are the search specialist on the user's AI cofounder team. You are given \
fresh web search results below — use them to answer with current, accurate information, and \
mention sources by name when relevant. If the results don't cover the question, say so. \
You have a scrape_url tool to fetch the FULL content of a specific promising result when the search \
snippet alone isn't enough to answer well — use it rather than guessing from the snippet. \
You have NO code execution, file access, or skills tools — only the dev agent does. If asked to run code, \
read/write a file, or use a named skill, say plainly that you can't do that here rather than inventing a result.`;

const TOOLS = [SCRAPE_TOOL];

async function dispatch(call) {
  const args = JSON.parse(call.function.arguments);
  if (call.function.name === 'scrape_url') return handleScrapeTool(args);
  return { error: `unknown tool: ${call.function.name}` };
}

/** @type {import('./agentInterface.js').AgentHandler} */
export async function handle(ctx) {
  if (ctx.images?.length) {
    const systemPrompt = await getSystemPrompt(name, DEFAULT_SYSTEM_PROMPT);
    const messages = await buildMessages({ systemPrompt, ctx });
    const reply = await chatCompletion({ model: MODELS.vision, messages, maxTokens: 400, userId: ctx.userId });
    return { reply };
  }

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

  const systemPrompt = await getSystemPrompt(name, DEFAULT_SYSTEM_PROMPT);
  const messages = await buildMessages({ systemPrompt, ctx, extra });

  const reply = await runToolLoop({ messages, tools: TOOLS, dispatch, maxIterations: 3, temperature: 0.3, userId: ctx.userId });
  return { reply };
}
