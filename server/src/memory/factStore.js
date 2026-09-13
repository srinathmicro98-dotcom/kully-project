import { supabase } from './supabaseClient.js';
import { embed, embedOne } from '../llm/embeddingsClient.js';

const FACT_TYPES = new Set(['decision', 'todo', 'architecture', 'preference', 'other']);

export async function storeFacts({ userId, project, facts, sourceMessageId }) {
  if (!facts.length) return;

  const vectors = await embed(
    facts.map((f) => f.content),
    'search_document',
  );

  const rows = facts.map((f, i) => ({
    user_id: userId,
    // The conversation's own project context wins over the model's per-fact
    // guess — it's the more reliable signal for which project this belongs to.
    project: project ?? f.project ?? null,
    fact_type: FACT_TYPES.has(f.fact_type) ? f.fact_type : 'other',
    content: f.content,
    embedding: vectors[i],
    source_message_id: sourceMessageId,
  }));

  const { error } = await supabase.from('facts').insert(rows);
  if (error) throw error;
}

export async function findRelevantFacts({ userId, project, query, matchCount = 5 }) {
  const queryEmbedding = await embedOne(query, 'search_query');

  const { data, error } = await supabase.rpc('match_facts', {
    query_embedding: queryEmbedding,
    match_user_id: userId,
    match_count: matchCount,
    match_project: project ?? null,
  });
  if (error) throw error;
  return data;
}
