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

// Recent-first, no embedding search — powers the Projects panel's "what does
// Kully remember about this project" view.
export async function listFactsForProject({ userId, project, limit = 20 }) {
  const { data, error } = await supabase
    .from('facts')
    .select('id, content, fact_type, created_at')
    .eq('user_id', userId)
    .eq('project', project)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// Manually added facts get embedded too, same as auto-extracted ones, so
// they're just as recallable — not a second-class "note" that only shows
// up in the project list view.
export async function addFact({ userId, project, content, factType }) {
  const embedding = await embedOne(content, 'search_document');
  const { data, error } = await supabase
    .from('facts')
    .insert({
      user_id: userId,
      project: project || 'default',
      content,
      fact_type: FACT_TYPES.has(factType) ? factType : 'other',
      embedding,
    })
    .select('id, content, fact_type, created_at')
    .single();
  if (error) throw error;
  return data;
}

export async function updateFact({ id, userId, content, factType }) {
  const patch = { fact_type: FACT_TYPES.has(factType) ? factType : undefined };
  if (content) {
    patch.content = content;
    patch.embedding = await embedOne(content, 'search_document');
  }
  Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);

  const { error } = await supabase.from('facts').update(patch).eq('id', id).eq('user_id', userId);
  if (error) throw error;
}

export async function deleteFact({ id, userId }) {
  const { error } = await supabase.from('facts').delete().eq('id', id).eq('user_id', userId);
  if (error) throw error;
}
