/**
 * Facebook Graph API publisher.
 *
 * Publishes a 1080×1080 PNG flyer with a caption to the BriefSphere Page feed.
 * Endpoint: POST /{page-id}/photos
 *
 * Retry strategy: 3 attempts with exponential backoff.
 * Rate limits at 4–10 posts/day are a non-issue for Graph API.
 *
 * Token strategy: System User token from Business Manager (non-expiring).
 * See token-health.ts for how to validate it before use.
 */

import { requireEnv, sleep } from '../config.js';

interface PhotoUploadResponse {
  id?: string;
  post_id?: string;
  error?: {
    message: string;
    type: string;
    code: number;
    fbtrace_id?: string;
  };
}

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2_000;

/**
 * Upload a PNG buffer + caption to the Page feed.
 * Returns the Facebook post ID on success.
 * Throws a descriptive Error on failure (caller handles alerts).
 */
export async function publishToFacebook(
  flyerBuffer: Buffer,
  caption: string,
  graphApiVersion: string
): Promise<string> {
  const pageId = requireEnv('FB_PAGE_ID');
  const accessToken = requireEnv('FB_SYSTEM_USER_TOKEN');

  const endpoint = `https://graph.facebook.com/${graphApiVersion}/${pageId}/photos`;

  let lastError: Error = new Error('Unknown error');

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[publish] Attempt ${attempt}/${MAX_RETRIES} — uploading to ${endpoint}`);

      // Build multipart form data
      const form = new FormData();
      form.append('access_token', accessToken);
      form.append('message', caption);
      form.append('published', 'true');
      form.append(
        'source',
        new Blob([flyerBuffer], { type: 'image/png' }),
        `briefsphere-${Date.now()}.png`
      );

      const res = await fetch(endpoint, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(30_000),  // 30s — image upload can be slow
      });

      const json = (await res.json()) as PhotoUploadResponse;

      // Handle API errors
      if (!res.ok || json.error) {
        const errMsg = json.error?.message ?? `HTTP ${res.status}`;
        const errCode = json.error?.code;

        // Facebook error codes worth knowing:
        //   190 = invalid/expired token (shouldn't happen with System User, but still)
        //   368 = temporary block
        //   10 = permission denied
        if (errCode === 190) {
          throw new Error(`Facebook token invalid (code 190): ${errMsg}`);
        }
        if (errCode === 10) {
          throw new Error(`Permission denied (code 10): ${errMsg}. Check page permissions.`);
        }

        throw new Error(`Facebook API error (code ${errCode}): ${errMsg}`);
      }

      // Extract the post ID — it's in post_id or id
      const postId = json.post_id ?? json.id;
      if (!postId) {
        throw new Error('Publish succeeded but no post_id returned');
      }

      console.log(`[publish] ✅ Published! Post ID: ${postId}`);
      return postId;

    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[publish] Attempt ${attempt} failed: ${lastError.message}`);

      if (attempt < MAX_RETRIES) {
        const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        console.log(`[publish] Retrying in ${delay / 1000}s...`);
        await sleep(delay);
      }
    }
  }

  throw new Error(`All ${MAX_RETRIES} publish attempts failed. Last error: ${lastError.message}`);
}
