import { buildMessages } from './agentInterface.js';
import { runToolLoop } from './toolLoop.js';
import { chatCompletion, MODELS } from '../../llm/groqClient.js';
import { getSystemPrompt } from '../../memory/agentConfigStore.js';
import { getHistoricalWithIndicators } from '../../llm/marketDataClient.js';
import { CREATE_ARTIFACT_TOOL, handleCreateArtifactTool } from './sharedTools.js';

export const name = 'trading';

export const DEFAULT_SYSTEM_PROMPT = `You are the markets/trading specialist on the user's AI cofounder team, \
focused on Indian equities (NSE). You are NOT a licensed financial advisor — you don't give personalized \
investment advice, you provide technical analysis of real market data and clearly-labeled ideas for the \
user to evaluate themselves. \
You have NO ability to place, modify, or cancel real orders, and must never imply otherwise — you cannot \
execute trades, full stop. Use get_market_data to pull REAL price history and indicators (SMA20/SMA50, \
RSI14, MACD) for an NSE ticker — never invent prices or indicator values. \
When you have a specific trade idea worth surfacing, use create_artifact (kind:"markdown") titled starting \
with "DRAFT ORDER — NOT EXECUTED" and include: symbol, side (buy/sell), suggested quantity, suggested price \
range, the technical rationale (which indicators/levels support it), and a line reminding the user this is \
not financial advice and they must place any order themselves through their own broker. Never create an \
artifact implying an order was actually placed. \
If asked to "buy X" or "sell X" directly, explain plainly that you can't execute trades and offer to \
prepare a draft order artifact instead, or just give the analysis.`;

const GET_MARKET_DATA_TOOL = {
  type: 'function',
  function: {
    name: 'get_market_data',
    description: 'Get real recent NSE price history and technical indicators (SMA20/50, RSI14, MACD) for an Indian stock.',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Plain NSE ticker, e.g. "RELIANCE", "TCS", "INFY", "HDFCBANK" — no exchange suffix.' },
        days: { type: ['number', 'null'], description: 'Days of price history to consider, defaults to 90.' },
      },
      required: ['symbol'],
    },
  },
};

const TOOLS = [GET_MARKET_DATA_TOOL, CREATE_ARTIFACT_TOOL];

async function dispatch(call, ctx) {
  const args = JSON.parse(call.function.arguments);
  if (call.function.name === 'get_market_data') return getHistoricalWithIndicators(args.symbol, args.days || 90);
  if (call.function.name === 'create_artifact') return handleCreateArtifactTool(args, ctx);
  return { error: `unknown tool: ${call.function.name}` };
}

/** @type {import('./agentInterface.js').AgentHandler} */
export async function handle(ctx) {
  const systemPrompt = await getSystemPrompt(name, DEFAULT_SYSTEM_PROMPT);

  if (ctx.images?.length) {
    // e.g. a chart screenshot the user pasted in.
    const messages = await buildMessages({ systemPrompt, ctx });
    const reply = await chatCompletion({ model: MODELS.vision, messages, maxTokens: 500, userId: ctx.userId });
    return { reply };
  }

  const messages = await buildMessages({ systemPrompt, ctx });
  const reply = await runToolLoop({
    messages,
    tools: TOOLS,
    dispatch: (call) => dispatch(call, ctx),
    maxIterations: 5,
    temperature: 0.3,
    userId: ctx.userId,
  });
  return { reply };
}
