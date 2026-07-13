/**
 * Image generation via Pollinations.ai
 *
 * Free, no API key, no account — ideal for Phase 0 and as a permanent fallback.
 * Returns the raw PNG buffer directly from the HTTP response.
 *
 * Known limitations:
 *   - No SLA, may be slow or occasionally unavailable
 *   - Generated images are publicly logged on Pollinations' site
 *   - Output size is approximate (resized by Sharp to exact 1080×1080 after)
 */

import type { ImageGenResult } from '../types.js';

const BASE_URL = 'https://image.pollinations.ai/prompt';
const TIMEOUT_MS = 45_000;  // Image generation can be slow

/**
 * Build a Pollinations URL from a prompt string.
 * Adds BriefSphere-specific parameters.
 */
function buildUrl(prompt: string): string {
  const encoded = encodeURIComponent(prompt);
  const params = new URLSearchParams({
    width: '1024',
    height: '1024',
    nologo: 'true',
    enhance: 'false',
    model: 'flux',
    seed: String(Math.floor(Math.random() * 1_000_000)),  // Vary per story
  });
  return `${BASE_URL}/${encoded}?${params.toString()}`;
}

export async function generateWithPollinations(prompt: string): Promise<ImageGenResult> {
  const url = buildUrl(prompt);
  console.log(`[image/pollinations] Generating image...`);

  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'User-Agent': 'BriefSphere-NewsBot/1.0 (+https://briefsphere.lk/about)',
    },
  });

  if (!res.ok) {
    throw new Error(`Pollinations returned HTTP ${res.status}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('image/')) {
    throw new Error(`Unexpected content-type: ${contentType}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());

  if (buffer.length < 10_000) {
    throw new Error(`Response too small (${buffer.length} bytes) — likely an error page`);
  }

  console.log(`[image/pollinations] ✓ Received ${(buffer.length / 1024).toFixed(0)} KB`);

  return { buffer, provider: 'pollinations', prompt };
}
