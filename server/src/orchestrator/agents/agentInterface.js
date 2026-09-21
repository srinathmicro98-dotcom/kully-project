import { getSetting } from '../../memory/settingsStore.js';

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
 * @property {string} [conversationSummary] Rolling summary of older turns beyond the recent-history
 *   window, prepended as context so long conversations don't lose earlier context.
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
// A user-facing "response_style" setting (Settings panel) can opt out of this.
const RESPONSE_STYLE_DIRECTIVES = {
  concise:
    'Be concise: answer directly, skip preamble/restating the question/hedging caveats you don\'t need. ' +
    'Use as many words as the answer genuinely requires and no more.',
  detailed:
    'Feel free to explain your reasoning and give thorough context where it helps understanding — ' +
    'still avoid padding with filler, but favor completeness over brevity.',
};

/**
 * Builds the Groq chat messages array shared by every agent: system prompt,
 * relevant long-term facts (if any), recent history, then the new message.
 * @param {{systemPrompt: string, ctx: AgentContext, extra?: string}} args
 */
export async function buildMessages({ systemPrompt, ctx, extra }) {
  let style = 'concise';
  try {
    style = await getSetting('response_style', 'concise');
  } catch {
    // app_settings unavailable (e.g. migration not yet applied) — fall back
    // to the default rather than breaking every chat request over a setting.
  }
  const directive = RESPONSE_STYLE_DIRECTIVES[style] || RESPONSE_STYLE_DIRECTIVES.concise;
  const messages = [{ role: 'system', content: `${systemPrompt}\n\n${directive}` }];

  if (ctx.conversationSummary) {
    messages.push({
      role: 'system',
      content: `Summary of earlier parts of this conversation (older messages have been condensed):\n${ctx.conversationSummary}`,
    });
  }

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
