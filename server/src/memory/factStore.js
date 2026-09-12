import { supabase } from './supabaseClient.js';
import { embed, embedOne } from '../llm/embeddingsClient.js';

export async function storeFacts({ userId, facts, sourceMessageId }) {
  if (!facts.length) return;

  const vectors = await embed(
    facts.map((f) => f.content),
    'search_document',
  );

  const rows = facts.map((f, i) => ({
    user_id: userId,
    project: f.project ?? null,
    content: f.content,
    embedding: vectors[i],
    source_message_id: sourceMessageId,
  }));

  const { error } = await supabase.from('facts').insert(rows);
  if (error) throw error;
}

export async function findRelevantFacts({ userId, query, matchCount = 5 }) {
  const queryEmbedding = await embedOne(query, 'search_query');

  const { data, error } = await supabase.rpc('match_facts', {
    query_embedding: queryEmbedding,
    match_user_id: userId,
    match_count: matchCount,
  });
  if (error) throw error;
  return data;
}
