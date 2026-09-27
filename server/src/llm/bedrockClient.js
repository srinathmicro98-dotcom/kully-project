// Claude Opus 5.5 via Amazon Bedrock — the "smart" reasoning tier for every
// specialist agent (dev/general/search/trading/video), replacing Groq's
// gpt-oss-120b there. Groq stays in place for routing (MODELS.fast), vision
// (MODELS.vision), fact extraction, and conversation summarization — this
// swap is scoped to the actual per-turn agent reasoning only.
//
// Uses the Bedrock "Mantle" client, which mirrors the real Anthropic Messages
// API 1:1 (unlike the older raw Invoke API) — no anthropic_version boilerplate,
// same request/response shape as the direct Claude API. Auth is the standard
// AWS credential chain (EC2 instance profile in production — see
// ARCHITECTURE.md for the required IAM policy), never a static key in .env.
//
// The rest of the app (toolLoop.js, every agent) speaks the OpenAI
// chat-completions shape (Groq is OpenAI-compatible) — `messages` with a
// `system` role mixed in, tool calls as `tool_calls`/`role:'tool'`. Rather
// than rewrite every agent and tool definition to Anthropic's shape, this
// module is a drop-in adapter: same `chatCompletion`/`chatCompletionWithTools`
// signatures as groqClient.js, translating to/from Anthropic's Messages API
// shape internally.
import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import { config } from '../config.js';
import { logUsage } from '../memory/usageStore.js';

const client = new AnthropicBedrockMantle({ awsRegion: config.awsBedrockRegion });

// Neither ap-south-1 (Mumbai) nor ap-south-2 (Hyderabad) support in-region or
// geo-restricted routing for this model (checked live against AWS's Bedrock
// model-card docs, 2026-09-27) — only global cross-region inference is
// available from this account's region, so requests may be processed outside
// India/APAC. Revisit if AWS adds geo-restricted routing here later.
const MODEL_ID = 'global.anthropic.claude-opus-5-5';

const DEFAULT_MAX_TOKENS = 4096;

// Claude Opus 5.5 returns a 400 on `temperature`/`top_p`/`top_k` at every
// effort level (sampling params are removed on this model) — unlike Groq,
// so any `temperature` an agent passes through runToolLoop is deliberately
// dropped here rather than forwarded. Effort (not temperature) is this
// model's quality/cost knob; "high" is set explicitly since intelligence-
// sensitive work (trading analysis, coding) is exactly why this swap happened
// — the model's own default ("medium") would leave quality on the table.
const OUTPUT_CONFIG = { effort: 'high' };

function toAnthropicTools(tools) {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

// Collapses the OpenAI-shape messages array (system role(s) mixed into
// `messages`, tool results as `role:'tool'`) into Anthropic's shape: one
// top-level `system` string plus a user/assistant-only `messages` array,
// with all tool_results for a turn combined into a single user message (the
// API requires this — split tool_results across messages are rejected).
// Exported (alongside toOpenAiMessage below) purely so these pure conversion
// functions can be unit-tested directly without a live Bedrock call.
export function toAnthropicRequest(openaiMessages) {
  const systemParts = [];
  const messages = [];
  let pendingToolResults = null;

  const flushToolResults = () => {
    if (pendingToolResults) {
      messages.push({ role: 'user', content: pendingToolResults });
      pendingToolResults = null;
    }
  };

  for (const m of openaiMessages) {
    if (m.role === 'system') {
      systemParts.push(typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
      continue;
    }
    if (m.role === 'tool') {
      pendingToolResults ??= [];
      pendingToolResults.push({ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content });
      continue;
    }
    flushToolResults();
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const content = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const call of m.tool_calls) {
        content.push({ type: 'tool_use', id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments || '{}') });
      }
      messages.push({ role: 'assistant', content });
      continue;
    }
    messages.push({ role: m.role, content: m.content });
  }
  flushToolResults();

  return { system: systemParts.join('\n\n') || undefined, messages };
}

// Converts an Anthropic response back into the OpenAI-shape `message` object
// (`{content, tool_calls}`) toolLoop.js already knows how to drive.
export function toOpenAiMessage(response) {
  let content = '';
  const toolCalls = [];
  for (const block of response.content) {
    if (block.type === 'text') content += block.text;
    else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input) },
      });
    }
  }
  return { content, tool_calls: toolCalls.length ? toolCalls : undefined };
}

function recordUsage(userId, response) {
  if (userId && response.usage) {
    logUsage({
      userId,
      model: MODEL_ID,
      kind: 'chat',
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
    });
  }
}

export async function chatCompletion({ messages, maxTokens = DEFAULT_MAX_TOKENS, userId }) {
  const { system, messages: anthropicMessages } = toAnthropicRequest(messages);
  const response = await client.messages.create({
    model: MODEL_ID,
    max_tokens: maxTokens,
    output_config: OUTPUT_CONFIG,
    system,
    messages: anthropicMessages,
  });
  recordUsage(userId, response);
  return toOpenAiMessage(response).content;
}

export async function chatCompletionWithTools({ messages, tools, maxTokens = DEFAULT_MAX_TOKENS, userId }) {
  const { system, messages: anthropicMessages } = toAnthropicRequest(messages);
  const response = await client.messages.create({
    model: MODEL_ID,
    max_tokens: maxTokens,
    output_config: OUTPUT_CONFIG,
    system,
    messages: anthropicMessages,
    tools: toAnthropicTools(tools),
  });
  recordUsage(userId, response);
  return toOpenAiMessage(response);
}
