import { supabase } from './supabaseClient.js';
import { logger } from '../utils/logger.js';

// USD per token, verified live against Groq's /models endpoint on 2026-09-19.
// Re-check before trusting this for anything beyond a rough estimate — Groq's
// catalog and pricing have both changed before.
const PRICING = {
  'openai/gpt-oss-20b': { prompt: 0.000000075, completion: 0.0000003 },
  'openai/gpt-oss-120b': { prompt: 0.00000015, completion: 0.0000006 },
  'qwen/qwen3.8-27b': { prompt: 0.0000008, completion: 0.000004 },
};

function estimateCost(model, promptTokens, completionTokens) {
  const rate = PRICING[model];
  if (!rate) return 0;
  return promptTokens * rate.prompt + completionTokens * rate.completion;
}

// Fire-and-forget by design — a usage-logging failure should never break the
// actual chat/image request it's measuring.
export async function logUsage({ userId, model, kind, promptTokens = 0, completionTokens = 0 }) {
  try {
    const { error } = await supabase.from('usage_log').insert({
      user_id: userId,
      model,
      kind,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
    });
    if (error) throw error;
  } catch (err) {
    logger.warn('usage logging failed:', err.message);
  }
}

export async function getUsageSummary({ userId, sinceDays = 30 }) {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('usage_log')
    .select('model, kind, prompt_tokens, completion_tokens, created_at')
    .eq('user_id', userId)
    .gte('created_at', since);
  if (error) throw error;

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalCostUsd = 0;
  let imageGenCount = 0;
  const byDay = new Map(); // date string -> { tokens, costUsd, imageGenCount }

  for (const row of data) {
    const day = row.created_at.slice(0, 10);
    const entry = byDay.get(day) ?? { tokens: 0, costUsd: 0, imageGenCount: 0 };

    if (row.kind === 'image_gen') {
      imageGenCount += 1;
      entry.imageGenCount += 1;
    } else {
      const cost = estimateCost(row.model, row.prompt_tokens, row.completion_tokens);
      totalPromptTokens += row.prompt_tokens;
      totalCompletionTokens += row.completion_tokens;
      totalCostUsd += cost;
      entry.tokens += row.prompt_tokens + row.completion_tokens;
      entry.costUsd += cost;
    }
    byDay.set(day, entry);
  }

  return {
    sinceDays,
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens: totalPromptTokens + totalCompletionTokens,
    estimatedCostUsd: Math.round(totalCostUsd * 10000) / 10000,
    imageGenCount,
    byDay: [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, v]) => ({ date, tokens: v.tokens, costUsd: Math.round(v.costUsd * 10000) / 10000, imageGenCount: v.imageGenCount })),
  };
}
