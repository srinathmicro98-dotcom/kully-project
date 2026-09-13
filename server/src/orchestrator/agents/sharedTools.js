import { scrapeUrl } from '../../llm/scraperClient.js';

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
