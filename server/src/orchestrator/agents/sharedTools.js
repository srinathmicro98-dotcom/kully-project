import { scrapeUrl } from '../../llm/scraperClient.js';
import { createArtifact } from '../../memory/artifactStore.js';

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
      'Save a substantial finished piece of output (a full file, a report, a design doc) as a viewable, ' +
      'downloadable artifact in the Artifacts panel — not for short snippets you can just show inline.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        kind: { type: 'string', enum: ['code', 'markdown', 'html', 'text'] },
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
