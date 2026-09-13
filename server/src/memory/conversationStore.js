import { supabase } from './supabaseClient.js';

export async function createConversation(userId, project = 'default') {
  const { data, error } = await supabase
    .from('conversations')
    .insert({ user_id: userId, project })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function setConversationTitle(conversationId, title) {
  const { error } = await supabase
    .from('conversations')
    .update({ title, updated_at: new Date().toISOString() })
    .eq('id', conversationId);
  if (error) throw error;
}

export async function listConversations(userId) {
  const { data, error } = await supabase
    .from('conversations')
    .select('id, project, title, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}

// One row per project this user has ever used, with a conversation count and
// when it was last touched — powers the Projects panel.
export async function listProjects(userId) {
  const { data, error } = await supabase
    .from('conversations')
    .select('project, updated_at')
    .eq('user_id', userId);
  if (error) throw error;

  const byProject = new Map();
  for (const row of data) {
    const entry = byProject.get(row.project) ?? { project: row.project, conversationCount: 0, lastUsed: row.updated_at };
    entry.conversationCount += 1;
    if (row.updated_at > entry.lastUsed) entry.lastUsed = row.updated_at;
    byProject.set(row.project, entry);
  }
  return [...byProject.values()].sort((a, b) => (a.lastUsed < b.lastUsed ? 1 : -1));
}

export async function getMessages(conversationId) {
  const { data, error } = await supabase
    .from('messages')
    .select('role, content, agent, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function insertMessage({ conversationId, role, content, agent = null }) {
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, role, content, agent })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function getRecentMessages(conversationId, limit = 10) {
  const { data, error } = await supabase
    .from('messages')
    .select('role, content, agent, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.reverse();
}

export async function logRouting({ messageId, classifiedAgent, rawModelOutput }) {
  const { error } = await supabase.from('routing_logs').insert({
    message_id: messageId,
    classified_agent: classifiedAgent,
    raw_model_output: rawModelOutput,
  });
  if (error) throw error;
}
