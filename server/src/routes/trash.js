import { Router } from 'express';
import { listDeletedFacts, restoreFact } from '../memory/factStore.js';
import { listDeletedTasks, restoreTask } from '../memory/scheduledTaskStore.js';
import { listDeletedSkills, restoreSkill } from '../memory/skillStore.js';

export const trashRouter = Router();

// One combined view of everything soft-deleted (facts/scheduled tasks/
// skills) in the last 30 days — anything older has already been purged by
// the daily backup Lambda.
trashRouter.get('/trash', async (req, res) => {
  const userId = req.query.user_id;
  if (!userId || typeof userId !== 'string') return res.status(400).json({ error: 'user_id is required' });

  const [facts, tasks, skills] = await Promise.all([
    listDeletedFacts(userId),
    listDeletedTasks(userId),
    listDeletedSkills(),
  ]);

  res.json([
    ...facts.map((f) => ({ type: 'fact', id: f.id, label: f.content, deletedAt: f.deleted_at })),
    ...tasks.map((t) => ({ type: 'scheduled_task', id: t.id, label: t.prompt, deletedAt: t.deleted_at })),
    ...skills.map((s) => ({ type: 'skill', id: s.name, label: `${s.name} — ${s.description}`, deletedAt: s.deleted_at })),
  ].sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1)));
});

trashRouter.post('/trash/restore', async (req, res) => {
  const { user_id: userId, type, id } = req.body ?? {};
  if (!userId || typeof userId !== 'string') return res.status(400).json({ error: 'user_id is required' });
  if (!id) return res.status(400).json({ error: 'id is required' });

  if (type === 'fact') await restoreFact({ id, userId });
  else if (type === 'scheduled_task') await restoreTask({ id, userId });
  else if (type === 'skill') await restoreSkill(id);
  else return res.status(400).json({ error: 'type must be "fact", "scheduled_task", or "skill"' });

  res.json({ ok: true });
});
