import { Router } from 'express';
import { listConversations, getMessages } from '../memory/conversationStore.js';

export const conversationsRouter = Router();

conversationsRouter.get('/conversations', async (req, res) => {
  const userId = req.query.user_id;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'user_id is required' });
  }
  res.json(await listConversations(userId));
});

conversationsRouter.get('/conversations/:id/messages', async (req, res) => {
  res.json(await getMessages(req.params.id));
});
