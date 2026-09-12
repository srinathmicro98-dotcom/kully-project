import { config } from '../config.js';

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

/**
 * @param {string} query
 * @returns {Promise<{title: string, url: string, content: string}[]>}
 */
export async function webSearch(query) {
  const res = await fetch(TAVILY_SEARCH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.tavilyApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      max_results: 5,
      search_depth: 'basic',
    }),
  });

  if (!res.ok) {
    throw new Error(`Tavily search failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return (data.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content,
  }));
}
