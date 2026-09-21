import { supabase } from './supabaseClient.js';

const CACHE_TTL_MS = 30_000;
let cache = null; // { value: Map<key, value>, expiresAt }

async function loadCache() {
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  const { data, error } = await supabase.from('app_settings').select('key, value');
  if (error) throw error;

  const value = new Map(data.map((r) => [r.key, r.value]));
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function getSetting(key, fallback) {
  const map = await loadCache();
  return map.has(key) ? map.get(key) : fallback;
}

export async function setSetting(key, value) {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw error;
  cache = null;
}
