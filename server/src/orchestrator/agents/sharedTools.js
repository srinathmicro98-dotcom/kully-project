import { scrapeUrl } from '../../llm/scraperClient.js';
import { createArtifact } from '../../memory/artifactStore.js';
import { logUsage } from '../../memory/usageStore.js';
import { findRelevantFactsGlobal } from '../../memory/factStore.js';

export const SCRAPE_TOOL = {
  type: 'function',
  function: {
    name: 'scrape_url',
    description:
      'Fetch a single web page and extract its clean readable text, links, or (with a CSS selector) ' +
      'specific matching elements. One page per call — decide which page to look at next yourself, ' +
      'this does not crawl automatically.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        selector: {
          type: ['string', 'null'],
          description: 'Optional CSS selector (e.g. "article p", "table.results td") to extract specific elements instead of the whole page text. Pass null to omit.',
        },
      },
      required: ['url'],
    },
  },
};

export async function handleScrapeTool(args) {
  return scrapeUrl({ url: args.url, selector: args.selector });
}

export const CREATE_ARTIFACT_TOOL = {
  type: 'function',
  function: {
    name: 'create_artifact',
    description:
      'Save a substantial finished piece of output (a full file, a report, a design doc, a chart) as a ' +
      'viewable, downloadable artifact in the Artifacts panel — not for short snippets you can just show ' +
      'inline. For kind=image/video, content must be a data URI (e.g. "data:image/png;base64,...").',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        kind: { type: 'string', enum: ['code', 'markdown', 'html', 'text', 'image', 'video'] },
        language: { type: ['string', 'null'], description: 'For kind=code, e.g. "python", "javascript".' },
        content: { type: 'string' },
      },
      required: ['title', 'kind', 'content'],
    },
  },
};

export async function handleCreateArtifactTool(args, ctx) {
  return createArtifact({
    userId: ctx.userId,
    project: ctx.project,
    conversationId: ctx.conversationId,
    title: args.title,
    kind: args.kind,
    language: args.language,
    content: args.content,
  });
}

export const GENERATE_IMAGE_TOOL = {
  type: 'function',
  function: {
    name: 'generate_image',
    description: 'Generate an image from a text description and show it to the user.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'A clear, detailed description of the desired image.' },
        width: { type: ['number', 'null'], description: 'Defaults to 1024 if omitted.' },
        height: { type: ['number', 'null'], description: 'Defaults to 1024 if omitted.' },
      },
      required: ['prompt'],
    },
  },
};

export async function handleGenerateImageTool(args, ctx) {
  const width = args.width || 1024;
  const height = args.height || 1024;
  const seed = Math.floor(Math.random() * 1_000_000_000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(args.prompt)}` +
    `?width=${width}&height=${height}&nologo=true&seed=${seed}`;

  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    return { error: `image generation failed: ${err.name === 'TimeoutError' ? 'timed out' : err.message}` };
  }
  if (!res.ok) return { error: `image generation failed: ${res.status}` };
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await res.arrayBuffer());
  const dataUri = `data:${contentType};base64,${buffer.toString('base64')}`;

  const artifact = await createArtifact({
    userId: ctx.userId,
    project: ctx.project,
    conversationId: ctx.conversationId,
    title: args.prompt.slice(0, 60),
    kind: 'image',
    language: null,
    content: dataUri,
  });
  logUsage({ userId: ctx.userId, model: 'pollinations', kind: 'image_gen' });

  ctx.generatedImages = ctx.generatedImages || [];
  ctx.generatedImages.push(dataUri);

  return { ok: true, artifactId: artifact.id, title: artifact.title };
}

export const RECALL_ACROSS_PROJECTS_TOOL = {
  type: 'function',
  function: {
    name: 'recall_across_projects',
    description:
      'Search the user\'s memory across ALL of their projects, not just the current one — use this when ' +
      'asked something like "did I decide this anywhere before" that the current project\'s own memory ' +
      'might not cover.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
};

export async function handleRecallAcrossProjectsTool(args, ctx) {
  const facts = await findRelevantFactsGlobal({ userId: ctx.userId, query: args.query });
  return { facts };
}
