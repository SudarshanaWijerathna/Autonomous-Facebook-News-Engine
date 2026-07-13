/**
 * Content hashing for deduplication.
 *
 * Hash input = headline + first N words of excerpt (normalised to lowercase,
 * punctuation stripped). This catches:
 *   - Same story re-published by the same source with a minor title tweak
 *   - Near-identical AP wire stories across multiple outlets
 */

import { createHash } from 'crypto';

/**
 * Normalise text for comparison:
 * - Lowercase
 * - Strip punctuation / special chars
 * - Collapse whitespace
 * - Trim
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generate a SHA-256 content hash for a story.
 *
 * @param headline  Story headline
 * @param excerpt   Story excerpt / body preview
 * @param wordCount Number of words from the excerpt to include (from rules.memory.dedupeHashWords)
 */
export function contentHash(headline: string, excerpt: string, wordCount: number): string {
  const normHeadline = normalise(headline);
  const normExcerptWords = normalise(excerpt).split(' ').slice(0, wordCount).join(' ');
  const input = `${normHeadline} ${normExcerptWords}`;
  return createHash('sha256').update(input, 'utf-8').digest('hex');
}

/**
 * Rough headline similarity — Jaccard index on word sets.
 * Used as a fast pre-filter before the more expensive Gemini similarity check.
 * Returns 0.0 (no overlap) to 1.0 (identical).
 */
export function headlineSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalise(a).split(' ').filter((w) => w.length > 3));
  const wordsB = new Set(normalise(b).split(' ').filter((w) => w.length > 3));

  if (wordsA.size === 0 && wordsB.size === 0) return 1.0;
  if (wordsA.size === 0 || wordsB.size === 0) return 0.0;

  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.size / union.size;
}
