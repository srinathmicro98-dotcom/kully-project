import { buildMessages } from './agentInterface.js';
import { runToolLoop } from './toolLoop.js';
import { chatCompletion, MODELS } from '../../llm/groqClient.js';
import { getSystemPrompt } from '../../memory/agentConfigStore.js';
import {
  CREATE_ARTIFACT_TOOL, handleCreateArtifactTool,
  GENERATE_IMAGE_TOOL, handleGenerateImageTool,
  RECALL_ACROSS_PROJECTS_TOOL, handleRecallAcrossProjectsTool,
} from './sharedTools.js';

export const name = 'general';

export const DEFAULT_SYSTEM_PROMPT = `You are the general reasoning/conversation specialist on the user's AI \
cofounder team. Handle everyday questions, brainstorming, planning, and anything that isn't a \
coding task or a request for current/live information. Be direct and conversational. \
Use create_artifact for a substantial finished piece of output (a report, a plan, a design doc) the user \
would want to view/save on its own — not for short answers. When asked for an image, ALWAYS call the \
generate_image tool to get a real generated picture — never hand-draw a crude SVG/base64 approximation \
yourself, the user asked for a generated image, not primitive shapes. Use recall_across_projects when \
asked something the current project's own memory might not cover. \
You have NO code execution, file access, or skills tools — only the dev agent does. If a request needs \
those (running code, reading/writing a file, or a named skill's real instructions), say plainly that you \
can't do that here and suggest asking again as a dev/coding question — never invent a plausible-sounding \
result for something you didn't actually do.`;

const TOOLS = [CREATE_ARTIFACT_TOOL, GENERATE_IMAGE_TOOL, RECALL_ACROSS_PROJECTS_TOOL];

async function dispatch(call, ctx) {
  const args = JSON.parse(call.function.arguments);
  if (call.function.name === 'create_artifact') return handleCreateArtifactTool(args, ctx);
  if (call.function.name === 'generate_image') return handleGenerateImageTool(args, ctx);
  if (call.function.name === 'recall_across_projects') return handleRecallAcrossProjectsTool(args, ctx);
  return { error: `unknown tool: ${call.function.name}` };
}

/** @type {import('./agentInterface.js').AgentHandler} */
export async function handle(ctx) {
  if (ctx.images?.length) {
    const systemPrompt = await getSystemPrompt(name, DEFAULT_SYSTEM_PROMPT);
    const messages = await buildMessages({ systemPrompt, ctx });
    const reply = await chatCompletion({ model: MODELS.vision, messages, maxTokens: 400, userId: ctx.userId });
    return { reply };
  }

  const systemPrompt = await getSystemPrompt(name, DEFAULT_SYSTEM_PROMPT);
  const messages = await buildMessages({ systemPrompt, ctx });
  const reply = await runToolLoop({ messages, tools: TOOLS, dispatch: (call) => dispatch(call, ctx), maxIterations: 2, temperature: 0.7, userId: ctx.userId });
  return { reply };
}
