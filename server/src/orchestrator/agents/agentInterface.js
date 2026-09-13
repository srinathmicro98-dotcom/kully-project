/**
 * @typedef AgentContext
 * @property {string} userId
 * @property {string} project
 * @property {string} conversationId
 * @property {string} message
 * @property {{role: string, content: string, agent?: string}[]} history
 * @property {{content: string, project?: string, fact_type?: string, similarity: number}[]} relevantFacts
 *
 * @typedef AgentResult
 * @property {string} reply
 * @property {object} [meta]
 *
 * @callback AgentHandler
 * @param {AgentContext} ctx
 * @returns {Promise<AgentResult>}
 */

/**
 * Builds the Groq chat messages array shared by every agent: system prompt,
 * relevant long-term facts (if any), recent history, then the new message.
 * @param {{systemPrompt: string, ctx: AgentContext, extra?: string}} args
 */
export function buildMessages({ systemPrompt, ctx, extra }) {
  const messages = [{ role: 'system', content: systemPrompt }];

  if (ctx.relevantFacts?.length) {
    const factsBlock = ctx.relevantFacts
      .map((f) => `- [${f.fact_type || 'other'}] ${f.content}`)
      .join('\n');
    messages.push({
      role: 'system',
      content: `Relevant things you remember about this user:\n${factsBlock}`,
    });
  }

  if (extra) {
    messages.push({ role: 'system', content: extra });
  }

  for (const turn of ctx.history) {
    messages.push({ role: turn.role, content: turn.content });
  }

  messages.push({ role: 'user', content: ctx.message });
  return messages;
}
