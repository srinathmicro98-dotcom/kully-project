import { supabase } from './supabaseClient.js';

export async function createConversation(userId) {
  const { data, error } = await supabase
    .from('conversations')
    .insert({ user_id: userId })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
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
