import { chatCompletionWithTools } from '../../llm/bedrockClient.js';
import { logger } from '../../utils/logger.js';

/**
 * Shared tool-calling loop, now backed by Claude Opus 5.5 via Bedrock (was
 * Groq's gpt-oss-120b — see bedrockClient.js): calls the model, dispatches
 * any tool_calls via `dispatch`, feeds results back, and repeats until the
 * model returns a plain answer or `maxIterations` is exhausted (then forces
 * one final no-tools reply so the user always gets something back).
 * `temperature`, if a caller still passes one, is accepted and ignored —
 * Claude Opus 5.5 rejects sampling params outright (see bedrockClient.js).
 */
export async function runToolLoop({ messages, tools, dispatch, maxIterations = 4, userId }) {
  for (let i = 0; i < maxIterations; i++) {
    const message = await chatCompletionWithTools({ messages, tools, userId });

    if (!message.tool_calls?.length) {
      return message.content ?? '';
    }

    messages.push({ role: 'assistant', content: message.content ?? '', tool_calls: message.tool_calls });

    for (const call of message.tool_calls) {
      let result;
      try {
        result = await dispatch(call);
      } catch (err) {
        logger.warn(`${call.function.name} tool failed:`, err.message);
        result = { error: err.message };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  const finalMessage = await chatCompletionWithTools({ messages, userId });
  return finalMessage.content || "I ran out of tool-call turns — here's what I found so far.";
}
