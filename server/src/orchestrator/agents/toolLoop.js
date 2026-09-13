import { chatCompletionWithTools, MODELS } from '../../llm/groqClient.js';
import { logger } from '../../utils/logger.js';

/**
 * Shared Groq tool-calling loop: calls the model, dispatches any tool_calls
 * via `dispatch`, feeds results back, and repeats until the model returns a
 * plain answer or `maxIterations` is exhausted (then forces one final
 * no-tools reply so the user always gets something back).
 */
export async function runToolLoop({ messages, tools, dispatch, maxIterations = 4, temperature = 0.4 }) {
  for (let i = 0; i < maxIterations; i++) {
    const message = await chatCompletionWithTools({ model: MODELS.smart, messages, tools, temperature });

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

  const finalMessage = await chatCompletionWithTools({ model: MODELS.smart, messages, temperature });
  return finalMessage.content || "I ran out of tool-call turns — here's what I found so far.";
}
