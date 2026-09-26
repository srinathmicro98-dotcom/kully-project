import { buildMessages } from './agentInterface.js';
import { runToolLoop } from './toolLoop.js';
import { chatCompletion, MODELS } from '../../llm/groqClient.js';
import { getSystemPrompt } from '../../memory/agentConfigStore.js';
import { youtubeSearchTrending, youtubeChannelStats, youtubeAnalytics, youtubeUploadVideo } from '../../llm/googleClient.js';
import {
  CREATE_ARTIFACT_TOOL, handleCreateArtifactTool,
  GENERATE_IMAGE_TOOL, handleGenerateImageTool,
} from './sharedTools.js';
import { config } from '../../config.js';

export const name = 'video';

const GOOGLE_ENABLED = !!config.googleClientId;

export const DEFAULT_SYSTEM_PROMPT = `You are the YouTube content specialist on the user's AI cofounder team — \
you research what's actually working on the platform and write complete, ready-to-record video scripts \
(hook, body beats, call-to-action) and thumbnail concepts, consistent with a recurring channel identity/avatar \
the user describes to you (keep tone/persona consistent across scripts). \
Use generate_image to create a real thumbnail image from a concept. Use create_artifact (kind:"markdown") to \
save a finished script, and create_artifact (kind:"image", after generate_image) for thumbnails, so the user \
can review/download them. \
You do NOT have avatar video generation (no provider is configured) — you write the script and prep the \
thumbnail, but an actual video FILE has to be produced with a separate tool the user hasn't set up yet; say \
so plainly if asked to "make the video" rather than implying you rendered one. \
NEVER suggest or describe using bots, fake views/watch time, purchased engagement, misleading \
titles/thumbnails, or anything that manipulates YouTube's recommendation system — that risks the channel \
being terminated. Growth advice must be legitimate: better hooks, retention, thumbnails, upload consistency, \
titles/descriptions matched to real search demand.${
  GOOGLE_ENABLED
    ? ' You also have research_youtube_trends (what\'s ranking well for a topic), get_channel_analytics (the ' +
      'connected channel\'s real recent view/watch-time numbers), and get_channel_stats (subscriber/view totals) ' +
      '— use real numbers from these, never guess at the user\'s own channel performance. upload_video exists ' +
      'but will tell you it needs a video file it doesn\'t have yet — that\'s expected, not a bug.'
    : ' YouTube isn\'t connected yet (Settings → Connectors), so you can\'t pull real trend/analytics data — ' +
      'say so rather than guessing at numbers, but you can still write scripts and generate thumbnail concepts.'
}`;

const TOOLS = [
  CREATE_ARTIFACT_TOOL,
  GENERATE_IMAGE_TOOL,
  ...(GOOGLE_ENABLED
    ? [
        {
          type: 'function',
          function: {
            name: 'research_youtube_trends',
            description: 'See what\'s currently ranking well on YouTube for a topic/niche — real search results ordered by view count.',
            parameters: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'get_channel_stats',
            description: 'Get the connected YouTube channel\'s real subscriber/view/video totals.',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
        {
          type: 'function',
          function: {
            name: 'get_channel_analytics',
            description: 'Get the connected channel\'s real day-by-day views/watch-time/subscribers-gained for recent days.',
            parameters: {
              type: 'object',
              properties: { days: { type: ['number', 'null'], description: 'Defaults to 28.' } },
              required: [],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'upload_video',
            description: 'Publish a finished video to the connected YouTube channel. Currently always returns an error — no avatar-video provider is configured, so there is no video file to upload.',
            parameters: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
              },
              required: ['title', 'description'],
            },
          },
        },
      ]
    : []),
];

async function dispatch(call, ctx) {
  const args = JSON.parse(call.function.arguments);
  switch (call.function.name) {
    case 'create_artifact':
      return handleCreateArtifactTool(args, ctx);
    case 'generate_image':
      return handleGenerateImageTool(args, ctx);
    case 'research_youtube_trends':
      return youtubeSearchTrending(ctx.userId, args.query);
    case 'get_channel_stats':
      return youtubeChannelStats(ctx.userId);
    case 'get_channel_analytics':
      return youtubeAnalytics(ctx.userId, args.days || 28);
    case 'upload_video':
      return youtubeUploadVideo();
    default:
      return { error: `unknown tool: ${call.function.name}` };
  }
}

/** @type {import('./agentInterface.js').AgentHandler} */
export async function handle(ctx) {
  const systemPrompt = await getSystemPrompt(name, DEFAULT_SYSTEM_PROMPT);

  if (ctx.images?.length) {
    const messages = await buildMessages({ systemPrompt, ctx });
    const reply = await chatCompletion({ model: MODELS.vision, messages, maxTokens: 500, userId: ctx.userId });
    return { reply };
  }

  const messages = await buildMessages({ systemPrompt, ctx });
  const reply = await runToolLoop({
    messages,
    tools: TOOLS,
    dispatch: (call) => dispatch(call, ctx),
    maxIterations: 6,
    temperature: 0.6,
    userId: ctx.userId,
  });
  return { reply };
}
