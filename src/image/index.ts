/**
 * Image generation orchestrator.
 *
 * Fallback chain:
 *   1. Primary: Cloudflare Workers AI (FLUX.1-schnell) — highest quality
 *      → Enabled when CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN are set
 *   2. Secondary: Pollinations.ai — no API key, free, good fallback
 *   3. Last resort: pre-made static category template background
 *      → Returns a Buffer read from templates/fallback/{category}.png
 *      → Never fails the post — a static fallback is better than no post
 *
 * The image prompt is built from story facts + style guide.
 * Copyrighted hero images are NEVER used directly — only their alt/caption text
 * is used as context for the generative prompt.
 */

import sharp from 'sharp';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { ScoredStory, ImageGenResult } from '../types.js';
import { generateWithPollinations } from './pollinations.js';
import { generateWithCloudflare } from './cloudflare.js';
import { getEnv } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FALLBACK_DIR = join(__dirname, '..', '..', 'templates', 'fallback');
const TARGET_SIZE = 1080;

/** Build the text-to-image prompt from story context and the house style guide */
function buildImagePrompt(story: ScoredStory, styleGuide: string): string {
  const contextLines: string[] = [
    `News illustration for: ${story.headline}`,
    story.heroImageAlt ? `Scene context: ${story.heroImageAlt}` : '',
    `Category: ${story.category}`,
    story.excerpt ? `Story context: ${story.excerpt.slice(0, 200)}` : '',
  ].filter(Boolean);

  return `${contextLines.join('. ')}. Style: ${styleGuide}. CRITICAL: Do not include any written text, words, spelling, letters, labels, or typography inside the image. The image must be pure illustration without any writing.`;
}

/** Resize any buffer to exactly 1080×1080 PNG */
async function resizeTo1080(inputBuffer: Buffer): Promise<Buffer> {
  return sharp(inputBuffer)
    .resize(TARGET_SIZE, TARGET_SIZE, {
      fit: 'cover',
      position: 'centre',
    })
    .png({ quality: 95 })
    .toBuffer();
}

/** Load the static fallback image for a category */
function loadFallbackImage(category: string): Buffer {
  // Try category-specific, then generic fallback
  const candidates = [
    join(FALLBACK_DIR, `${category.toLowerCase().replace(/[^a-z]/g, '-')}.png`),
    join(FALLBACK_DIR, 'standard.png'),
    join(FALLBACK_DIR, 'default.png'),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      console.log(`[image] Using fallback template: ${path}`);
      return readFileSync(path);
    }
  }

  // If no fallback images exist, create a simple solid-color 1080×1080 PNG
  // This should never happen in production (README instructs creating fallbacks)
  console.warn('[image] No fallback template found — generating solid background');
  return sharp({
    create: {
      width: TARGET_SIZE,
      height: TARGET_SIZE,
      channels: 3,
      background: { r: 15, g: 23, b: 42 },  // dark slate
    },
  })
    .png()
    .toBuffer() as unknown as Buffer;
}

/** Check if Cloudflare credentials are configured */
function cloudflareEnabled(): boolean {
  return Boolean(getEnv('CLOUDFLARE_ACCOUNT_ID') && getEnv('CLOUDFLARE_API_TOKEN'));
}

/**
 * Generate a 1080×1080 background image for a story.
 * Never throws — falls back through the chain until a buffer is returned.
 */
export async function generateImage(
  story: ScoredStory,
  styleGuide: string
): Promise<ImageGenResult> {
  const prompt = buildImagePrompt(story, styleGuide);
  console.log(`[image] Prompt: "${prompt.slice(0, 120)}..."`);

  // ── Try Cloudflare first (if credentials present) ─────────────────────────
  if (cloudflareEnabled()) {
    try {
      const result = await generateWithCloudflare(prompt);
      const resized = await resizeTo1080(result.buffer);
      return { ...result, buffer: resized };
    } catch (err) {
      console.warn(`[image] Cloudflare failed: ${(err as Error).message} — trying Pollinations`);
    }
  }

  // ── Try Pollinations ───────────────────────────────────────────────────────
  try {
    const result = await generateWithPollinations(prompt);
    const resized = await resizeTo1080(result.buffer);
    return { ...result, buffer: resized };
  } catch (err) {
    console.warn(`[image] Pollinations failed: ${(err as Error).message} — using static fallback`);
  }

  // ── Static category fallback ───────────────────────────────────────────────
  const fallbackBuffer = await loadFallbackImage(story.category);
  const resized = await resizeTo1080(
    Buffer.isBuffer(fallbackBuffer) ? fallbackBuffer : await (fallbackBuffer as Promise<Buffer>)
  );

  return { buffer: resized, provider: 'fallback', prompt };
}
