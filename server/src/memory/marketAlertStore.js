import { supabase } from './supabaseClient.js';

export async function createAlert({ userId, project, symbol, indicator, comparator, threshold }) {
  const { data, error } = await supabase
    .from('market_alerts')
    .insert({
      user_id: userId,
      project: project || 'default',
      symbol: symbol.toUpperCase(),
      indicator,
      comparator,
      threshold,
    })
    .select('id, project, symbol, indicator, comparator, threshold, enabled, triggered_at, created_at')
    .single();
  if (error) throw error;
  return data;
}

export async function listAlerts(userId) {
  const { data, error } = await supabase
    .from('market_alerts')
    .select('id, project, symbol, indicator, comparator, threshold, enabled, triggered_at, created_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function setAlertEnabled({ id, userId, enabled }) {
  const { error } = await supabase.from('market_alerts').update({ enabled }).eq('id', id).eq('user_id', userId);
  if (error) throw error;
}

// Soft delete — see factStore.js's deleteFact for the rationale/lifecycle.
export async function deleteAlert({ id, userId }) {
  const { error } = await supabase
    .from('market_alerts')
    .update({ deleted_at: new Date().toISOString(), enabled: false })
    .eq('id', id).eq('user_id', userId);
  if (error) throw error;
}

export async function restoreAlert({ id, userId }) {
  const { error } = await supabase.from('market_alerts').update({ deleted_at: null }).eq('id', id).eq('user_id', userId);
  if (error) throw error;
}

export async function listDeletedAlerts(userId) {
  const { data, error } = await supabase
    .from('market_alerts')
    .select('id, symbol, indicator, comparator, threshold, deleted_at')
    .eq('user_id', userId)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });
  if (error) throw error;
  return data;
}
