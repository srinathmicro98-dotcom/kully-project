import * as cheerio from 'cheerio';

const MAX_CONTENT = 6000;
const FETCH_TIMEOUT_MS = 10000;
const MAX_LINKS = 40;
const MAX_SELECTOR_MATCHES = 30;

function truncate(s) {
  return s.length > MAX_CONTENT ? `${s.slice(0, MAX_CONTENT)}\n… (truncated)` : s;
}

/**
 * Fetches a single URL and extracts clean, model-friendly content — readable
 * text, links, or matches for a CSS selector. No crawling: one page per call,
 * the agent decides which page to look at next.
 */
export async function scrapeUrl({ url, selector }) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`invalid URL: ${url}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('only http/https URLs are supported');
  }

  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'User-Agent': 'KullyBot/1.0 (+https://github.com/srinathmicro98-dotcom/kully-project)',
    },
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('html')) {
    // Not HTML (JSON/plain text/etc.) — just return the raw text.
    return { url, contentType, text: truncate(await res.text()) };
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();

  const title = $('title').first().text().trim();
  const description = $('meta[name="description"]').attr('content')?.trim() || '';

  if (selector) {
    const matches = $(selector);
    const items = matches
      .slice(0, MAX_SELECTOR_MATCHES)
      .map((_, el) => $(el).text().trim().replace(/\s+/g, ' '))
      .get();
    return { url, title, description, selector, matchCount: matches.length, items: items.map(truncate) };
  }

  const text = $('body').text().replace(/\s+/g, ' ').trim();

  const seen = new Set();
  const links = [];
  $('a[href]').each((_, el) => {
    if (links.length >= MAX_LINKS) return;
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    let absolute;
    try {
      absolute = new URL(href, url).href;
    } catch {
      return;
    }
    if (seen.has(absolute)) return;
    seen.add(absolute);
    links.push({ text: $(el).text().trim().replace(/\s+/g, ' ').slice(0, 100), href: absolute });
  });

  return { url, title, description, text: truncate(text), links };
}
