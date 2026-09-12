import Groq from 'groq-sdk';
import { config } from '../config.js';

const groq = new Groq({ apiKey: config.groqApiKey });

// Groq's current catalog (Llama 3.x was retired) — both are gpt-oss reasoning
// models, so every call hides reasoning tokens and only returns final content.
export const MODELS = {
  fast: 'openai/gpt-oss-20b',
  smart: 'openai/gpt-oss-120b',
};

export async function chatCompletion({
  model,
  messages,
  temperature = 0.7,
  maxTokens = 1024,
  reasoningEffort = 'medium',
}) {
  const res = await groq.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    reasoning_effort: reasoningEffort,
    reasoning_format: 'hidden',
  });
  return res.choices[0]?.message?.content ?? '';
}

/**
 * Like chatCompletion, but returns the full message (so callers can inspect
 * `tool_calls`) and accepts a `tools` definition for function calling.
 */
export async function chatCompletionWithTools({
  model,
  messages,
  tools,
  temperature = 0.4,
  maxTokens = 1024,
  reasoningEffort = 'medium',
}) {
  const res = await groq.chat.completions.create({
    model,
    messages,
    tools,
    tool_choice: tools ? 'auto' : undefined,
    temperature,
    max_tokens: maxTokens,
    reasoning_effort: reasoningEffort,
    reasoning_format: 'hidden',
  });
  return res.choices[0]?.message;
}
