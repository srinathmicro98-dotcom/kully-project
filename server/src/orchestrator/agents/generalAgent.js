import { buildMessages } from './agentInterface.js';
import { runToolLoop } from './toolLoop.js';
import { chatCompletion, MODELS } from '../../llm/groqClient.js';
import { getSystemPrompt } from '../../memory/agentConfigStore.js';
import {
  CREATE_ARTIFACT_TOOL, handleCreateArtifactTool,
  GENERATE_IMAGE_TOOL, handleGenerateImageTool,
  RECALL_ACROSS_PROJECTS_TOOL, handleRecallAcrossProjectsTool,
} from './sharedTools.js';
import { calendarListEvents } from '../../llm/googleClient.js';
import { config } from '../../config.js';

export const name = 'general';

const GOOGLE_ENABLED = !!config.googleClientId;

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
result for something you didn't actually do.${
  GOOGLE_ENABLED
    ? ' Use get_calendar_events for real upcoming events on the user\'s connected calendar — never guess at their schedule.'
    : ' Calendar isn\'t connected yet (Settings → Connectors), so if asked about their schedule, say so rather than guessing.'
}`;

const TOOLS = [
  CREATE_ARTIFACT_TOOL, GENERATE_IMAGE_TOOL, RECALL_ACROSS_PROJECTS_TOOL,
  ...(GOOGLE_ENABLED
    ? [{
        type: 'function',
        function: {
          name: 'get_calendar_events',
          description: 'Get real upcoming events from the user\'s connected Google Calendar.',
          parameters: {
            type: 'object',
            properties: { days: { type: ['number', 'null'], description: 'How many days ahead, defaults to 7.' } },
            required: [],
          },
        },
      }]
    : []),
];

async function dispatch(call, ctx) {
  const args = JSON.parse(call.function.arguments);
  if (call.function.name === 'create_artifact') return handleCreateArtifactTool(args, ctx);
  if (call.function.name === 'generate_image') return handleGenerateImageTool(args, ctx);
  if (call.function.name === 'recall_across_projects') return handleRecallAcrossProjectsTool(args, ctx);
  if (call.function.name === 'get_calendar_events') return calendarListEvents(ctx.userId, args.days || 7);
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
