/**
 * RSS feed adapter.
 *
 * For each source, tries each rssUrls entry in order.
 * Returns an empty array (not an error) if all URLs fail — the caller (discover/index)
 * will fall through to the scraper fallback.
 */

import Parser from 'rss-parser';
import type { Source, RawStory } from '../types.js';
import { contentHash } from '../dedupe/hash.js';
import { sleep } from '../config.js';

// rss-parser types the items generically — extend with common fields we care about
type FeedItem = {
  title?: string;
  link?: string;
  contentSnippet?: string;
  content?: string;
  isoDate?: string;
  pubDate?: string;
  enclosure?: { url?: string };
  'media:content'?: { $?: { url?: string } };
  'media:thumbnail'?: { $?: { url?: string } };
};

const parser = new Parser<Record<string, unknown>, FeedItem>({
  customFields: {
    item: [
      ['media:content', 'media:content'],
      ['media:thumbnail', 'media:thumbnail'],
    ],
  },
  timeout: 10_000,  // 10 seconds per feed fetch
  headers: {
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  },
});

/** Extract a hero image URL from a parsed RSS item using common field patterns */
function extractImageUrl(item: FeedItem): string | undefined {
  return (
    item.enclosure?.url ||
    item['media:content']?.['$']?.url ||
    item['media:thumbnail']?.['$']?.url ||
    undefined
  );
}

/** Extract excerpt text — prefer contentSnippet, fall back to stripped content */
function extractExcerpt(item: FeedItem, maxWords = 150): string {
  const raw = item.contentSnippet || item.content || '';
  // Strip HTML tags
  const stripped = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return stripped.split(/\s+/).slice(0, maxWords).join(' ');
}

/**
 * Attempt to fetch and parse one RSS feed URL.
 * Returns null if the fetch fails or if the feed is empty.
 */
async function tryFeedUrl(
  url: string,
  source: Source,
  wordCount: number
): Promise<RawStory[] | null> {
  try {
    const feed = await parser.parseURL(url);

    if (!feed.items || feed.items.length === 0) return null;

    const stories: RawStory[] = [];

    for (const item of feed.items) {
      const headline = item.title?.trim();
      const link = item.link?.trim();

      if (!headline || !link) continue;  // Skip malformed items

      const excerpt = extractExcerpt(item);
      const publishedAt = item.isoDate
        ? new Date(item.isoDate)
        : item.pubDate
          ? new Date(item.pubDate)
          : new Date();

      stories.push({
        sourceId: source.id,
        sourceName: source.name,
        headline,
        excerpt,
        url: link,
        publishedAt,
        heroImageUrl: extractImageUrl(item),
        heroImageAlt: undefined,  // RSS rarely provides alt text
        contentHash: contentHash(headline, excerpt, wordCount),
      });
    }

    console.log(`[rss] ${source.name}: fetched ${stories.length} items from ${url}`);
    return stories;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[rss] ${source.name}: failed to parse ${url} — ${msg}`);
    return null;
  }
}

/**
 * Fetch stories for one source via RSS.
 * Tries each URL in the source's rssUrls array in order.
 * Returns an empty array if all URLs fail (caller will try scraper fallback).
 */
export async function fetchRss(source: Source, dedupeWordCount: number): Promise<RawStory[]> {
  for (const url of source.rssUrls) {
    const stories = await tryFeedUrl(url, source, dedupeWordCount);
    if (stories !== null) {
      return stories;  // First successful feed wins
    }
    await sleep(500);  // Brief pause between URL attempts
  }

  console.warn(`[rss] ${source.name}: all RSS URLs failed`);
  return [];
}
