import { supabase } from './supabaseClient.js';

export async function getConnector(userId, provider) {
  const { data, error } = await supabase
    .from('connectors')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateConnectorToken(userId, provider, { accessToken, expiresAt }) {
  const { error } = await supabase
    .from('connectors')
    .update({ access_token: accessToken, expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('provider', provider);
  if (error) throw error;
}
