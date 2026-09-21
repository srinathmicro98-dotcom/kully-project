import Groq from 'groq-sdk';
import { config } from '../config.js';
import { logUsage } from '../memory/usageStore.js';

const groq = new Groq({ apiKey: config.groqApiKey });

// Groq's current catalog (Llama 3.x was retired) — both are gpt-oss reasoning
// models, so every call hides reasoning tokens and only returns final content.
// Verified live against GET /openai/v1/models on 2026-09-19 — re-check before
// assuming these still exist, the catalog has changed before.
export const MODELS = {
  fast: 'openai/gpt-oss-20b',
  smart: 'openai/gpt-oss-120b',
  // Only Groq model with input_modalities including "image" as of the last
  // live check. Also supports tool-calling, but we keep vision turns as a
  // single direct call (see agent handle()s) rather than routing them
  // through the tool loop, to keep the vision path simple and predictable.
  vision: 'qwen/qwen3.8-27b',
  whisper: 'whisper-large-v3-turbo',
  // Requires the org to accept this model's terms in the Groq console before
  // it will actually respond (verified live — returns `model_terms_required`
  // until then). Dormant until accepted, same pattern as the GitHub/Google
  // integrations: built now, activated later.
  tts: 'canopylabs/orpheus-v1-english',
};

export async function chatCompletion({
  model,
  messages,
  temperature = 0.7,
  maxTokens = 1024,
  reasoningEffort = 'medium',
  userId,
}) {
  const res = await groq.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    reasoning_effort: reasoningEffort,
    reasoning_format: 'hidden',
  });
  if (userId && res.usage) {
    logUsage({ userId, model, kind: 'chat', promptTokens: res.usage.prompt_tokens, completionTokens: res.usage.completion_tokens });
  }
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
  userId,
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
  if (userId && res.usage) {
    logUsage({ userId, model, kind: 'chat', promptTokens: res.usage.prompt_tokens, completionTokens: res.usage.completion_tokens });
  }
  return res.choices[0]?.message;
}

/**
 * Transcribes recorded speech via Groq Whisper. `buffer` is the raw audio
 * bytes (webm/mp3/wav/etc — whatever the browser's MediaRecorder produced).
 */
export async function transcribeAudio(buffer, filename = 'audio.webm') {
  const file = new File([buffer], filename);
  const res = await groq.audio.transcriptions.create({
    file,
    model: MODELS.whisper,
  });
  return res.text ?? '';
}

/**
 * Text-to-speech. The installed groq-sdk (0.7.0) predates Groq's TTS
 * endpoint, so this calls the OpenAI-compatible REST API directly rather
 * than going through the SDK client.
 */
export async function textToSpeech(text, voice = 'hannah') {
  const res = await fetch('https://api.groq.com/openai/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.groqApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: MODELS.tts, input: text, voice, response_format: 'wav' }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Groq TTS returned ${res.status}: ${body}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
