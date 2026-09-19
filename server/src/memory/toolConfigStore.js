import { supabase } from './supabaseClient.js';

const CACHE_TTL_MS = 30_000; // shorter than agent/skill caches — toggling a tool off should bite fast
let cache = null; // { value: Map<name, boolean>, expiresAt }

async function loadCache() {
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  const { data, error } = await supabase.from('tool_config').select('tool_name, enabled');
  if (error) throw error;

  const value = new Map(data.map((r) => [r.tool_name, r.enabled]));
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

// Unknown tools (no row yet) default to enabled — a tool has to be
// explicitly turned off, not explicitly turned on.
export async function isToolEnabled(name) {
  const map = await loadCache();
  return map.has(name) ? map.get(name) : true;
}

export async function listToolConfig(allToolNames) {
  const map = await loadCache();
  return allToolNames.map((name) => ({ name, enabled: map.has(name) ? map.get(name) : true }));
}

export async function setToolEnabled(name, enabled) {
  const { error } = await supabase
    .from('tool_config')
    .upsert({ tool_name: name, enabled, updated_at: new Date().toISOString() });
  if (error) throw error;
  cache = null;
}
