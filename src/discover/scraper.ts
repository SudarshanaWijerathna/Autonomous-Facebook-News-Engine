/**
 * HTML scraper fallback.
 *
 * Used when a source has no working RSS feed.
 * Each source's CSS selectors are isolated in sources.json — one site
 * redesigning its HTML doesn't affect any other source.
 *
 * Robots.txt is checked before scraping. If disallowed, returns empty array.
 */

import * as cheerio from 'cheerio';
import type { Source, RawStory } from '../types.js';
import { contentHash } from '../dedupe/hash.js';

const FETCH_TIMEOUT_MS = 12_000;
const MAX_ITEMS_PER_SOURCE = 20;

/** Check robots.txt — returns true if scraping is permitted */
async function isAllowedByRobots(baseUrl: string, userAgent: string): Promise<boolean> {
  try {
    const robotsUrl = new URL('/robots.txt', baseUrl).href;
    const res = await fetch(robotsUrl, {
      signal: AbortSignal.timeout(5_000),
      headers: { 'User-Agent': userAgent },
    });

    if (!res.ok) {
      // If robots.txt is missing (404), scraping is generally permitted
      return res.status === 404;
    }

    const text = await res.text();
    const lines = text.split('\n');

    let inRelevantBlock = false;
    let disallowed = false;

    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('User-agent:')) {
        const agent = line.replace('User-agent:', '').trim();
        inRelevantBlock = agent === '*' || agent.toLowerCase() === 'briefsphere-newsbot';
      } else if (inRelevantBlock && line.startsWith('Disallow:')) {
        const path = line.replace('Disallow:', '').trim();
        // Disallow: / means everything is blocked
        if (path === '/' || path === '') {
          disallowed = true;
          break;
        }
      }
    }

    return !disallowed;
  } catch {
    // Assume allowed if robots.txt can't be fetched
    return true;
  }
}

/** Resolve a relative URL against the source's base URL */
function resolveUrl(href: string | undefined, baseUrl: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return undefined;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractText($el: any): string {
  return $el.text().replace(/\s+/g, ' ').trim();
}

/**
 * Scrape stories from a source's homepage.
 * Returns empty array if robots.txt disallows or if fetching fails.
 */
export async function scrapeSource(source: Source, dedupeWordCount: number): Promise<RawStory[]> {
  if (!source.scrapeFallback.enabled || !source.scrapeFallback.itemSelectors) {
    return [];
  }

  // Robots check
  const allowed = await isAllowedByRobots(source.baseUrl, source.userAgent);
  if (!allowed) {
    console.warn(`[scraper] ${source.name}: robots.txt disallows scraping — skipping`);
    return [];
  }

  // Fetch the page
  let html: string;
  try {
    const res = await fetch(source.baseUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': source.userAgent,
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!res.ok) {
      console.warn(`[scraper] ${source.name}: HTTP ${res.status}`);
      return [];
    }

    html = await res.text();
  } catch (err) {
    console.warn(`[scraper] ${source.name}: fetch failed — ${(err as Error).message}`);
    return [];
  }

  // Parse with cheerio
  const $ = cheerio.load(html);
  const { listSelector, itemSelectors } = source.scrapeFallback;
  const stories: RawStory[] = [];

  const items = listSelector ? $(listSelector) : $('article, .news-item, .post-item');

  items.slice(0, MAX_ITEMS_PER_SOURCE).each((_, el) => {
    const $el = $(el);

    // Try headline + link
    const $link = $el.find(itemSelectors.headline).first();
    const headline = extractText($link);
    const rawHref = $link.attr('href') || $el.find('a').first().attr('href') || $el.attr('href');
    const url = resolveUrl(rawHref, source.baseUrl);

    if (!headline || !url) return;  // skip malformed items

    // Excerpt
    const excerptSel = itemSelectors.excerpt;
    const excerpt = excerptSel
      ? extractText($el.find(excerptSel).first()).split(/\s+/).slice(0, 150).join(' ')
      : '';

    // Hero image
    const imageSel = itemSelectors.image;
    const imgSrc = imageSel
      ? ($el.find(imageSel).first().attr('src') ||
         $el.find(imageSel).first().attr('data-src'))
      : undefined;
    const heroImageUrl = imgSrc ? resolveUrl(imgSrc, source.baseUrl) : undefined;

    // Published at — scrapers rarely expose structured dates; default to now
    const publishedAt = new Date();

    stories.push({
      sourceId: source.id,
      sourceName: source.name,
      headline,
      excerpt,
      url,
      publishedAt,
      heroImageUrl,
      heroImageAlt: undefined,
      contentHash: contentHash(headline, excerpt, dedupeWordCount),
    });
  });

  console.log(`[scraper] ${source.name}: scraped ${stories.length} items`);
  return stories;
}
