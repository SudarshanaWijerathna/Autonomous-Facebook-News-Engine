/**
 * Image generation via Cloudflare Workers AI — FLUX.1-schnell
 *
 * Generates at 1024×1024 (FLUX max supported size on Cloudflare).
 * Sharp resizes to 1080×1080 after.
 *
 * Free tier: ~10,000 neurons/day. FLUX.1-schnell costs ~40 neurons/image
 * → ~250 images/day free. Well above the 4–10 posts/day target.
 *
 * ⚠️ Verify current neuron costs in Cloudflare's docs before relying on this
 *    estimate — it's subject to change.
 */

import type { ImageGenResult } from '../types.js';
import { requireEnv } from '../config.js';

const MODEL_PATH = '@cf/black-forest-labs/flux-1-schnell';
const TIMEOUT_MS = 60_000;  // Cloudflare cold starts can be slow

function buildApiUrl(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL_PATH}`;
}

export async function generateWithCloudflare(prompt: string): Promise<ImageGenResult> {
  const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID');
  const apiToken = requireEnv('CLOUDFLARE_API_TOKEN');

  console.log(`[image/cloudflare] Generating image via FLUX.1-schnell...`);

  const res = await fetch(buildApiUrl(accountId), {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      width: 1024,
      height: 1024,
      num_steps: 4,  // schnell is optimized for 1-4 steps
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cloudflare AI returned HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  // Cloudflare returns JSON with base64-encoded image
  const json = await res.json() as {
    result?: { image?: string };
    success?: boolean;
    errors?: Array<{ message: string }>;
  };

  if (!json.success || !json.result?.image) {
    const errMsg = json.errors?.map((e) => e.message).join(', ') ?? 'No image in response';
    throw new Error(`Cloudflare AI error: ${errMsg}`);
  }

  const buffer = Buffer.from(json.result.image, 'base64');

  if (buffer.length < 10_000) {
    throw new Error(`Response image too small (${buffer.length} bytes)`);
  }

  console.log(`[image/cloudflare] ✓ Received ${(buffer.length / 1024).toFixed(0)} KB`);

  return { buffer, provider: 'cloudflare', prompt };
}
