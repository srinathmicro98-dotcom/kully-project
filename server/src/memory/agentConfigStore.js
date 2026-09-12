import { supabase } from './supabaseClient.js';

const CACHE_TTL_MS = 60_000;
const cache = new Map(); // agentName -> { prompt, expiresAt }

export async function getSystemPrompt(agentName, fallback) {
  const cached = cache.get(agentName);
  if (cached && cached.expiresAt > Date.now()) return cached.prompt;

  const { data, error } = await supabase
    .from('agent_config')
    .select('system_prompt')
    .eq('agent_name', agentName)
    .maybeSingle();

  const prompt = !error && data?.system_prompt ? data.system_prompt : fallback;
  cache.set(agentName, { prompt, expiresAt: Date.now() + CACHE_TTL_MS });
  return prompt;
}

export async function listAgentConfigs(defaults) {
  const { data, error } = await supabase.from('agent_config').select('agent_name, system_prompt');
  if (error) throw error;
  const dbMap = new Map((data ?? []).map((r) => [r.agent_name, r.system_prompt]));
  return Object.entries(defaults).map(([agentName, fallback]) => ({
    name: agentName,
    systemPrompt: dbMap.get(agentName) ?? fallback,
  }));
}

export async function updateSystemPrompt(agentName, systemPrompt) {
  const { error } = await supabase
    .from('agent_config')
    .upsert({ agent_name: agentName, system_prompt: systemPrompt, updated_at: new Date().toISOString() });
  if (error) throw error;
  cache.delete(agentName); // invalidate so the very next message picks it up
}
