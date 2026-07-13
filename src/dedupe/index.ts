/**
 * Deduplication filter.
 *
 * Two passes:
 *
 * Pass 1 — Exact dedup: URL match or content hash match against memory.
 *   Fast, no API calls needed.
 *
 * Pass 2 — Cross-source dedup: catch the same event covered by multiple outlets
 *   with different URLs and wording. Uses headline Jaccard similarity as a fast
 *   pre-filter. Stories within the configured time window with similarity above
 *   the threshold are considered duplicates — keep the one with more detail
 *   (longer excerpt) or a hero image, and optionally credit both sources.
 *
 * Within-batch dedup: stories found in this run can also be dupes of each other
 *   (same event, multiple sources) — dedupe the batch itself too.
 */

import type { RawStory, MemoryEntry } from '../types.js';
import { isKnown, getRecentEntries } from '../memory/index.js';
import { headlineSimilarity } from './hash.js';

interface DedupeConfig {
  crossSourceSimilarityThreshold: number;
  crossSourceTimeWindowHours: number;
}

/**
 * Filter a batch of raw stories, returning only genuinely new ones.
 *
 * @param stories   Stories from this run's discovery pass
 * @param memory    Full in-memory store (loaded at start of run)
 * @param config    Thresholds from rules.json
 */
export function dedupeFilter(
  stories: RawStory[],
  memory: MemoryEntry[],
  config: DedupeConfig
): { kept: RawStory[]; skipped: Array<{ story: RawStory; reason: string }> } {
  const kept: RawStory[] = [];
  const skipped: Array<{ story: RawStory; reason: string }> = [];

  // ── Pass 1: Exact dedup against memory ──────────────────────────────────────
  const pass1: RawStory[] = [];
  for (const story of stories) {
    if (isKnown(memory, story.url, story.contentHash)) {
      skipped.push({ story, reason: 'exact-duplicate-in-memory' });
    } else {
      pass1.push(story);
    }
  }

  // ── Pass 2a: Cross-source dedup against recent memory entries ───────────────
  const recentMemory = getRecentEntries(memory, config.crossSourceTimeWindowHours);
  const pass2: RawStory[] = [];

  for (const story of pass1) {
    let isDupe = false;
    for (const memEntry of recentMemory) {
      const sim = headlineSimilarity(story.headline, memEntry.headline);
      if (sim >= config.crossSourceSimilarityThreshold) {
        skipped.push({ story, reason: `cross-source-duplicate-of-published (sim=${sim.toFixed(2)})` });
        isDupe = true;
        break;
      }
    }
    if (!isDupe) pass2.push(story);
  }

  // ── Pass 2b: Cross-source dedup within the batch itself ──────────────────────
  // Group stories by similarity and keep the "best" from each group.
  const seen: RawStory[] = [];

  for (const story of pass2) {
    let isDupeOfBatch = false;

    for (const other of seen) {
      // Only consider stories within the configured time window of each other
      const timeDiffHours =
        Math.abs(story.publishedAt.getTime() - other.publishedAt.getTime()) / (3_600_000);

      if (timeDiffHours > config.crossSourceTimeWindowHours) continue;

      const sim = headlineSimilarity(story.headline, other.headline);
      if (sim >= config.crossSourceSimilarityThreshold) {
        // It's a batch dupe — keep the one with more detail (longer excerpt + has image)
        const storyScore = story.excerpt.length + (story.heroImageUrl ? 200 : 0);
        const otherScore = other.excerpt.length + (other.heroImageUrl ? 200 : 0);

        if (storyScore > otherScore) {
          // Current story is better — replace the one already in seen
          const idx = seen.indexOf(other);
          seen.splice(idx, 1, story);
          skipped.push({ story: other, reason: `batch-cross-source-duplicate-of-${story.sourceId} (sim=${sim.toFixed(2)})` });
        } else {
          skipped.push({ story, reason: `batch-cross-source-duplicate-of-${other.sourceId} (sim=${sim.toFixed(2)})` });
        }

        isDupeOfBatch = true;
        break;
      }
    }

    if (!isDupeOfBatch) {
      seen.push(story);
    }
  }

  // ── URL dedup within batch (same URL from different fetch paths) ─────────────
  const urlSeen = new Set<string>();
  for (const story of seen) {
    if (urlSeen.has(story.url)) {
      skipped.push({ story, reason: 'url-duplicate-within-batch' });
    } else {
      urlSeen.add(story.url);
      kept.push(story);
    }
  }

  return { kept, skipped };
}
