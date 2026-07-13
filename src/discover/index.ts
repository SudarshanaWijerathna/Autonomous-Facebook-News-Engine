/**
 * Discovery orchestrator.
 *
 * For each enabled source:
 *   1. Try RSS (faster, lighter, more reliable)
 *   2. Fall back to scraper if RSS returns nothing AND scrapeFallback.enabled
 *
 * Sources run sequentially with a brief delay between them — polite crawling.
 */

import type { Source, RawStory } from '../types.js';
import { fetchRss } from './rss.js';
import { scrapeSource } from './scraper.js';
import { sleep } from '../config.js';

const BETWEEN_SOURCE_DELAY_MS = 1_500;  // 1.5 seconds between sources

/**
 * Discover stories from all enabled sources.
 * Each source is isolated — one failure does not stop the others.
 */
export async function discoverAll(
  sources: Source[],
  dedupeWordCount: number
): Promise<RawStory[]> {
  const allStories: RawStory[] = [];

  for (const source of sources) {
    try {
      console.log(`[discover] Starting source: ${source.name}`);

      // Try RSS first
      let stories = await fetchRss(source, dedupeWordCount);

      // Fall back to scraper if RSS returned nothing
      if (stories.length === 0 && source.scrapeFallback.enabled) {
        console.log(`[discover] ${source.name}: RSS empty, trying scraper fallback`);
        stories = await scrapeSource(source, dedupeWordCount);
      }

      console.log(`[discover] ${source.name}: ${stories.length} stories`);
      allStories.push(...stories);

    } catch (err) {
      // Isolate failures — one broken source doesn't take down the run
      console.error(`[discover] ${source.name}: unexpected error — ${(err as Error).message}`);
    }

    await sleep(BETWEEN_SOURCE_DELAY_MS);
  }

  console.log(`[discover] Total discovered: ${allStories.length} stories from ${sources.length} sources`);
  return allStories;
}
