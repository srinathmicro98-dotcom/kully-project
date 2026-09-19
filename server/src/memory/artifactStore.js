import { supabase } from './supabaseClient.js';

const KINDS = new Set(['code', 'markdown', 'html', 'text', 'image', 'video']);

export async function createArtifact({ userId, project, conversationId, title, kind, language, content }) {
  const { data, error } = await supabase
    .from('artifacts')
    .insert({
      user_id: userId,
      project: project || 'default',
      conversation_id: conversationId || null,
      title,
      kind: KINDS.has(kind) ? kind : 'text',
      language: language || null,
      content,
    })
    .select('id, title, kind')
    .single();
  if (error) throw error;
  return data;
}

export async function listArtifacts({ userId, project }) {
  let query = supabase
    .from('artifacts')
    .select('id, title, kind, language, project, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (project) query = query.eq('project', project);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getArtifact(id) {
  const { data, error } = await supabase.from('artifacts').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}
