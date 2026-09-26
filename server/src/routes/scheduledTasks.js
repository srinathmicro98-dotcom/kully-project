import { Router } from 'express';
import { createTask, listTasks, setTaskEnabled, deleteTask } from '../memory/scheduledTaskStore.js';

export const scheduledTasksRouter = Router();

scheduledTasksRouter.get('/scheduled-tasks', async (req, res) => {
  const userId = req.query.user_id;
  if (!userId || typeof userId !== 'string') return res.status(400).json({ error: 'user_id is required' });
  res.json(await listTasks(userId));
});

scheduledTasksRouter.post('/scheduled-tasks', async (req, res) => {
  const { user_id: userId, project, prompt, schedule_type: scheduleType, run_at: runAt, time_of_day: timeOfDay } = req.body ?? {};

  if (!userId || typeof userId !== 'string') return res.status(400).json({ error: 'user_id is required' });
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'prompt is required' });
  if (!['once', 'daily'].includes(scheduleType)) return res.status(400).json({ error: 'schedule_type must be "once" or "daily"' });
  if (scheduleType === 'once' && (!runAt || Number.isNaN(Date.parse(runAt)))) {
    return res.status(400).json({ error: 'run_at (ISO timestamp) is required for a one-time task' });
  }
  if (scheduleType === 'daily' && !/^\d{2}:\d{2}$/.test(timeOfDay || '')) {
    return res.status(400).json({ error: 'time_of_day ("HH:MM", UTC) is required for a daily task' });
  }

  const task = await createTask({ userId, project, prompt, scheduleType, runAt, timeOfDay });
  res.json(task);
});

scheduledTasksRouter.put('/scheduled-tasks/:id', async (req, res) => {
  const { user_id: userId, enabled } = req.body ?? {};
  if (!userId || typeof userId !== 'string') return res.status(400).json({ error: 'user_id is required' });
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean' });
  await setTaskEnabled({ id: req.params.id, userId, enabled });
  res.json({ ok: true });
});

scheduledTasksRouter.delete('/scheduled-tasks/:id', async (req, res) => {
  const userId = req.query.user_id;
  if (!userId || typeof userId !== 'string') return res.status(400).json({ error: 'user_id is required' });
  await deleteTask({ id: req.params.id, userId });
  res.json({ ok: true });
});
