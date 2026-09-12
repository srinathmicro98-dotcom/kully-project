import { chatCompletionWithTools, MODELS } from '../../llm/groqClient.js';
import { buildMessages } from './agentInterface.js';
import { getSystemPrompt } from '../../memory/agentConfigStore.js';
import { runCode } from '../../llm/codeRunnerClient.js';
import { logger } from '../../utils/logger.js';

export const name = 'dev';

export const DEFAULT_SYSTEM_PROMPT = `You are the dev/build specialist on the user's AI cofounder team. \
You help with code, debugging, architecture, and technical build decisions. Be concrete and \
give runnable code or exact commands where relevant. Keep answers focused, not padded. \
You have a run_code tool that actually executes Node.js or Python snippets in a sandboxed \
workspace that persists across turns for this user — use it whenever running the code would \
give a more reliable answer than reasoning about it (verifying logic, testing a function, \
processing data), instead of just describing what the code would do.`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'run_code',
      description:
        'Execute a Node.js or Python snippet in an isolated sandbox and return stdout/stderr. ' +
        'Files written to disk persist across calls for this user (e.g. write a file in one call, read it in the next).',
      parameters: {
        type: 'object',
        properties: {
          language: { type: 'string', enum: ['node', 'python'] },
          code: { type: 'string', description: 'The full source code to run as the entry point.' },
        },
        required: ['language', 'code'],
      },
    },
  },
];

const MAX_TOOL_ITERATIONS = 3;

/** @type {import('./agentInterface.js').AgentHandler} */
export async function handle(ctx) {
  const systemPrompt = await getSystemPrompt(name, DEFAULT_SYSTEM_PROMPT);
  const messages = buildMessages({ systemPrompt, ctx });

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const message = await chatCompletionWithTools({
      model: MODELS.smart,
      messages,
      tools: TOOLS,
      temperature: 0.4,
    });

    if (!message.tool_calls?.length) {
      return { reply: message.content ?? '' };
    }

    messages.push({ role: 'assistant', content: message.content ?? '', tool_calls: message.tool_calls });

    for (const call of message.tool_calls) {
      let result;
      try {
        const args = JSON.parse(call.function.arguments);
        result = await runCode({ language: args.language, code: args.code, userId: ctx.userId });
      } catch (err) {
        logger.warn('run_code tool failed:', err.message);
        result = { error: err.message };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  // Exhausted the loop without a final answer — force one last reply, no tools offered.
  const finalMessage = await chatCompletionWithTools({ model: MODELS.smart, messages, temperature: 0.4 });
  return { reply: finalMessage.content || "I ran out of tool-call turns — here's what I found so far." };
}
