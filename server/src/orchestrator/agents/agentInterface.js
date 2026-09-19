/**
 * @typedef AgentContext
 * @property {string} userId
 * @property {string} project
 * @property {string} conversationId
 * @property {string} message
 * @property {{role: string, content: string, agent?: string}[]} history
 * @property {{content: string, project?: string, fact_type?: string, similarity: number}[]} relevantFacts
 * @property {string[]} [images] Data-URI images attached to this turn, for vision-capable calls.
 * @property {string[]} [generatedImages] Side-channel the generate_image tool appends data URIs to,
 *   read back by chat.js after handle() returns so the response can include them for inline display.
 *
 * @typedef AgentResult
 * @property {string} reply
 * @property {object} [meta]
 *
 * @callback AgentHandler
 * @param {AgentContext} ctx
 * @returns {Promise<AgentResult>}
 */

// Applied to every agent so replies stay direct rather than padded — also
// keeps completions shorter, which matters on tighter free-tier token limits.
const CONCISE_DIRECTIVE =
  'Be concise: answer directly, skip preamble/restating the question/hedging caveats you don\'t need. ' +
  'Use as many words as the answer genuinely requires and no more.';

/**
 * Builds the Groq chat messages array shared by every agent: system prompt,
 * relevant long-term facts (if any), recent history, then the new message.
 * @param {{systemPrompt: string, ctx: AgentContext, extra?: string}} args
 */
export function buildMessages({ systemPrompt, ctx, extra }) {
  const messages = [{ role: 'system', content: `${systemPrompt}\n\n${CONCISE_DIRECTIVE}` }];

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

  if (ctx.images?.length) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: ctx.message },
        ...ctx.images.map((url) => ({ type: 'image_url', image_url: { url } })),
      ],
    });
  } else {
    messages.push({ role: 'user', content: ctx.message });
  }
  return messages;
}
