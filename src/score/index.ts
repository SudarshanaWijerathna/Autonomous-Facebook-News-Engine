/**
 * Scoring + caption generation via Gemini.
 *
 * Both operations happen in ONE API call per story to conserve quota.
 * Uses responseMimeType: 'application/json' so Gemini returns clean JSON,
 * no markdown fences to strip.
 *
 * Rate limit awareness:
 *   Flash-lite free tier: 15 RPM / 1,500 RPD
 *   At 4-10 stories/run, a 4-second delay between calls keeps us well under.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { RawStory, ScoredStory, GeminiScoreResponse, Category } from '../types.js';
import { CATEGORIES } from '../types.js';
import { requireEnv, sleep } from '../config.js';

const BETWEEN_CALL_DELAY_MS = 5_500;  // 5.5 seconds → ~11 RPM (safely under the 15 RPM free tier limit)

function buildPrompt(story: RawStory, imageStyle: string): string {
  const hoursAgo = (Date.now() - story.publishedAt.getTime()) / 3_600_000;
  const ageLabel =
    hoursAgo < 1
      ? 'less than 1 hour ago'
      : hoursAgo < 6
        ? `${Math.round(hoursAgo)} hours ago`
        : `${Math.round(hoursAgo / 24)} days ago`;

  return `You are the editorial AI for BriefSphere, a Sri Lankan news Facebook Page publishing in English.

Your task: score this story for publication suitability and write a Facebook caption.

STORY:
  Headline: ${story.headline}
  Source: ${story.sourceName}
  Published: ${ageLabel}
  URL: ${story.url}
  Excerpt: ${story.excerpt.slice(0, 600)}

SCORING RUBRIC (total 100 points — be realistic, most stories score 50–80):
  Scale of impact (0–25): How significant is this nationally or globally?
  Sri Lankan relevance (0–25): Direct local relevance scores higher (this is a Sri Lankan community page).
  Recency (0–20): <1h=20, <3h=17, <6h=14, <12h=10, <24h=6, older=2
  Source corroboration (0–15): Is this covered by major/credible outlets?
  Novelty (0–15): Genuinely new information vs. incremental update to an ongoing story?

CAPTION REQUIREMENTS:
  1. Hook line: single most important fact, front-loaded (Facebook truncates after ~3 lines)
  2. 2–4 sentences of original context in your own words (NEVER copy or closely paraphrase source text)
  3. Why it matters specifically to Sri Lankans (if there's a genuine local angle)
  4. Source line: exactly "📰 Source: ${story.sourceName}"
  5. A genuine question (NOT engagement bait like "comment YES" or "tag a friend")
  6. 3–6 hashtags: always include #BriefSphere, then 1–2 topical, 1 location-based

CAPTION RULES:
  - English only
  - Original language — re-express facts, never copy or mirror source structure
  - No engagement bait phrases
  - No sensationalism for accidents/deaths — measured, respectful tone
  - Political coverage: factual and neutral
  - Under 350 words total

VALID CATEGORIES: ${CATEGORIES.join(' | ')}

Respond with ONLY this exact JSON structure (no markdown, no commentary):
{
  "score": <integer 0–100>,
  "category": "<one of the valid categories above>",
  "isBreaking": <true if score >= 92 AND this is a major breaking event, otherwise false>,
  "reasoning": "<one sentence explaining the score — be specific about what drove it up or down>",
  "caption": "<full Facebook caption following the structure above>"
}`;
}

function parseGeminiResponse(text: string, story: RawStory): GeminiScoreResponse | null {
  try {
    const parsed = JSON.parse(text);

    // Validate required fields
    if (
      typeof parsed.score !== 'number' ||
      !CATEGORIES.includes(parsed.category as Category) ||
      typeof parsed.isBreaking !== 'boolean' ||
      typeof parsed.caption !== 'string' ||
      typeof parsed.reasoning !== 'string'
    ) {
      console.warn(`[score] Invalid response shape for "${story.headline.slice(0, 50)}"`);
      return null;
    }

    // Clamp score to valid range
    parsed.score = Math.max(0, Math.min(100, Math.round(parsed.score)));

    return parsed as GeminiScoreResponse;
  } catch (err) {
    console.warn(`[score] JSON parse failed for "${story.headline.slice(0, 50)}": ${(err as Error).message}`);
    return null;
  }
}

let _ai: GoogleGenerativeAI | null = null;

function getModel(modelName: string) {
  if (!_ai) {
    _ai = new GoogleGenerativeAI(requireEnv('GEMINI_API_KEY'));
  }
  return _ai.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.4,  // Low temp for consistent JSON output
      maxOutputTokens: 1024,
    },
  });
}

/**
 * Score and caption a single story via Gemini.
 * Retries once on JSON parse failure.
 * Returns null if both attempts fail — caller skips the story.
 */
export async function scoreAndCaption(
  story: RawStory,
  modelName: string,
  imageStyle: string,
  maxRetries: number
): Promise<ScoredStory | null> {
  const model = getModel(modelName);
  const prompt = buildPrompt(story, imageStyle);

  let lastError: string = '';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      const parsed = parseGeminiResponse(responseText, story);

      if (parsed) {
        return {
          ...story,
          score: parsed.score,
          category: parsed.category,
          isBreaking: parsed.isBreaking,
          captionDraft: parsed.caption,
          scoreReasoning: parsed.reasoning,
        };
      }

      lastError = 'Invalid response shape';
    } catch (err) {
      lastError = (err as Error).message;
      console.warn(`[score] Attempt ${attempt}/${maxRetries} failed for "${story.headline.slice(0, 50)}": ${lastError}`);
    }

    if (attempt < maxRetries) await sleep(2_000);
  }

  console.error(`[score] All attempts failed for "${story.headline.slice(0, 50)}": ${lastError}`);
  return null;
}

/**
 * Score all stories. Each call is sequential (rate limit compliance).
 * Returns only successfully scored stories — failures are logged and skipped.
 */
export async function scoreAll(
  stories: RawStory[],
  modelName: string,
  imageStyle: string,
  maxRetries: number
): Promise<{ scored: ScoredStory[]; failed: RawStory[] }> {
  const scored: ScoredStory[] = [];
  const failed: RawStory[] = [];

  for (let i = 0; i < stories.length; i++) {
    const story = stories[i];
    console.log(`[score] Scoring ${i + 1}/${stories.length}: "${story.headline.slice(0, 60)}"`);

    const result = await scoreAndCaption(story, modelName, imageStyle, maxRetries);

    if (result) {
      scored.push(result);
      console.log(`[score]   → ${result.score}/100 [${result.category}]${result.isBreaking ? ' 🚨 BREAKING' : ''}`);
    } else {
      failed.push(story);
    }

    // Rate limit: pause between calls (skip delay after last item)
    if (i < stories.length - 1) await sleep(BETWEEN_CALL_DELAY_MS);
  }

  return { scored, failed };
}
