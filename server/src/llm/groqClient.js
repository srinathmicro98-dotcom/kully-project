import Groq from 'groq-sdk';
import { config } from '../config.js';

const groq = new Groq({ apiKey: config.groqApiKey });

export const MODELS = {
  fast: 'llama-3.1-8b-instant',
  smart: 'llama-3.3-70b-versatile',
};

export async function chatCompletion({ model, messages, temperature = 0.7, maxTokens }) {
  const res = await groq.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  });
  return res.choices[0]?.message?.content ?? '';
}
