import { Router } from 'express';
import { agents, agentNames } from '../orchestrator/agents/index.js';
import { listAgentConfigs, updateSystemPrompt } from '../memory/agentConfigStore.js';

export const agentsRouter = Router();

agentsRouter.get('/agents', async (_req, res) => {
  const defaults = Object.fromEntries(
    agentNames.map((name) => [name, agents[name].DEFAULT_SYSTEM_PROMPT]),
  );
  res.json(await listAgentConfigs(defaults));
});

agentsRouter.put('/agents/:name', async (req, res) => {
  const { name } = req.params;
  const { systemPrompt } = req.body ?? {};

  if (!agentNames.includes(name)) {
    return res.status(404).json({ error: 'unknown agent' });
  }
  if (!systemPrompt || typeof systemPrompt !== 'string') {
    return res.status(400).json({ error: 'systemPrompt is required' });
  }

  await updateSystemPrompt(name, systemPrompt);
  res.json({ ok: true });
});
