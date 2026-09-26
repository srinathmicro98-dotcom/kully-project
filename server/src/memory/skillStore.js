import { supabase } from './supabaseClient.js';

const CACHE_TTL_MS = 60_000;
let menuCache = null; // { value, expiresAt } — the name+description list every agent turn needs
const bodyCache = new Map(); // name -> { body, expiresAt } — fetched only when actually invoked

export async function listSkillsMenu() {
  if (menuCache && menuCache.expiresAt > Date.now()) return menuCache.value;

  const { data, error } = await supabase.from('skills').select('name, description').is('deleted_at', null).order('name');
  if (error) throw error;

  menuCache = { value: data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}

export async function getSkillBody(name) {
  const cached = bodyCache.get(name);
  if (cached && cached.expiresAt > Date.now()) return cached.body;

  const { data, error } = await supabase.from('skills').select('body').eq('name', name).is('deleted_at', null).maybeSingle();
  if (error) throw error;

  const body = data?.body ?? null;
  bodyCache.set(name, { body, expiresAt: Date.now() + CACHE_TTL_MS });
  return body;
}

export async function listAllSkills() {
  const { data, error } = await supabase.from('skills').select('*').is('deleted_at', null).order('name');
  if (error) throw error;
  return data;
}

export async function upsertSkill({ name, description, body }) {
  const { error } = await supabase
    .from('skills')
    .upsert({ name, description, body, updated_at: new Date().toISOString(), deleted_at: null });
  if (error) throw error;
  menuCache = null;
  bodyCache.delete(name);
}

// Soft delete — see factStore.js's deleteFact for the rationale/lifecycle.
export async function deleteSkill(name) {
  const { error } = await supabase.from('skills').update({ deleted_at: new Date().toISOString() }).eq('name', name);
  if (error) throw error;
  menuCache = null;
  bodyCache.delete(name);
}

export async function restoreSkill(name) {
  const { error } = await supabase.from('skills').update({ deleted_at: null }).eq('name', name);
  if (error) throw error;
  menuCache = null;
  bodyCache.delete(name);
}

export async function listDeletedSkills() {
  const { data, error } = await supabase
    .from('skills')
    .select('name, description, deleted_at')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });
  if (error) throw error;
  return data;
}
