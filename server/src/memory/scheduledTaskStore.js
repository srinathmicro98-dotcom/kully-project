import { supabase } from './supabaseClient.js';

function nextDailyRunAt(timeOfDay) {
  const [h, m] = timeOfDay.split(':').map(Number);
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, 0));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

export async function createTask({ userId, project, prompt, scheduleType, runAt, timeOfDay }) {
  const computedRunAt = scheduleType === 'daily' ? nextDailyRunAt(timeOfDay) : runAt;
  const { data, error } = await supabase
    .from('scheduled_tasks')
    .insert({
      user_id: userId,
      project: project || 'default',
      prompt,
      schedule_type: scheduleType,
      run_at: computedRunAt,
      time_of_day: scheduleType === 'daily' ? timeOfDay : null,
    })
    .select('id, project, prompt, schedule_type, run_at, time_of_day, enabled, last_run_at, created_at')
    .single();
  if (error) throw error;
  return data;
}

export async function listTasks(userId) {
  const { data, error } = await supabase
    .from('scheduled_tasks')
    .select('id, project, prompt, schedule_type, run_at, time_of_day, enabled, last_run_at, created_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function setTaskEnabled({ id, userId, enabled }) {
  const { error } = await supabase.from('scheduled_tasks').update({ enabled }).eq('id', id).eq('user_id', userId);
  if (error) throw error;
}

// Soft delete — see factStore.js's deleteFact for the rationale/lifecycle.
// Also disables the task (defense in depth) so a soft-deleted-but-somehow-
// still-enabled row can never be picked up by the Lambda's due-task check.
export async function deleteTask({ id, userId }) {
  const { error } = await supabase
    .from('scheduled_tasks')
    .update({ deleted_at: new Date().toISOString(), enabled: false })
    .eq('id', id).eq('user_id', userId);
  if (error) throw error;
}

export async function restoreTask({ id, userId }) {
  const { error } = await supabase.from('scheduled_tasks').update({ deleted_at: null }).eq('id', id).eq('user_id', userId);
  if (error) throw error;
}

export async function listDeletedTasks(userId) {
  const { data, error } = await supabase
    .from('scheduled_tasks')
    .select('id, prompt, schedule_type, deleted_at')
    .eq('user_id', userId)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });
  if (error) throw error;
  return data;
}
