import { Router } from 'express';
import { ALL_TOOL_NAMES } from '../orchestrator/agents/devAgent.js';
import { listToolConfig, setToolEnabled } from '../memory/toolConfigStore.js';

export const toolsRouter = Router();

toolsRouter.get('/tools', async (_req, res) => {
  res.json(await listToolConfig(ALL_TOOL_NAMES));
});

toolsRouter.put('/tools/:name', async (req, res) => {
  const { name } = req.params;
  const { enabled } = req.body ?? {};

  if (!ALL_TOOL_NAMES.includes(name)) {
    return res.status(404).json({ error: 'unknown tool' });
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }

  await setToolEnabled(name, enabled);
  res.json({ ok: true });
});
