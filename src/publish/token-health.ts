/**
 * Facebook token health checker.
 *
 * Called at the START of every pipeline run — before any expensive work —
 * so a dead/revoked token is caught immediately and alerts fire before the
 * run tries to publish and fails midway.
 *
 * Uses the Graph API /debug_token endpoint.
 *
 * System User tokens (generated from Business Manager) don't expire on a timer,
 * but they CAN be:
 *   - Revoked by a password change on the associated account
 *   - Revoked by Meta for policy violations
 *   - Invalidated if the app's permissions are changed
 *
 * This check catches all of the above.
 */

import { requireEnv } from '../config.js';

interface DebugTokenData {
  is_valid: boolean;
  expires_at?: number;  // 0 = never expires (System User tokens)
  scopes?: string[];
  error?: {
    code: number;
    message: string;
    subcode?: number;
  };
  app_id?: string;
  user_id?: string;
  type?: string;
}

interface DebugTokenResponse {
  data?: DebugTokenData;
  error?: { message: string; code: number };
}

const REQUIRED_SCOPES = ['pages_manage_posts', 'pages_read_engagement', 'pages_show_list'];

export async function checkTokenHealth(graphApiVersion: string): Promise<{
  valid: boolean;
  reason?: string;
  scopes?: string[];
}> {
  const pageToken = requireEnv('FB_SYSTEM_USER_TOKEN');
  // The app access token is the same token for System Users
  // (they have an access_token that acts as both user and app token)
  const appToken = pageToken;

  const url = new URL(`https://graph.facebook.com/${graphApiVersion}/debug_token`);
  url.searchParams.set('input_token', pageToken);
  url.searchParams.set('access_token', appToken);

  try {
    const res = await fetch(url.href, { signal: AbortSignal.timeout(10_000) });
    const json = (await res.json()) as DebugTokenResponse;

    if (!res.ok || json.error) {
      return {
        valid: false,
        reason: json.error?.message ?? `HTTP ${res.status}`,
      };
    }

    const data = json.data;
    if (!data) {
      return { valid: false, reason: 'Empty debug_token response' };
    }

    if (!data.is_valid) {
      return {
        valid: false,
        reason: data.error?.message ?? 'Token marked as invalid by Facebook',
      };
    }

    // Check required scopes
    const grantedScopes = data.scopes ?? [];
    const missingScopes = REQUIRED_SCOPES.filter((s) => !grantedScopes.includes(s));
    if (missingScopes.length > 0) {
      return {
        valid: false,
        reason: `Missing required scopes: ${missingScopes.join(', ')}`,
        scopes: grantedScopes,
      };
    }

    console.log(`[token] ✓ Token valid | Type: ${data.type ?? 'unknown'} | Scopes: ${grantedScopes.join(', ')}`);

    return { valid: true, scopes: grantedScopes };

  } catch (err) {
    return {
      valid: false,
      reason: `Token check failed: ${(err as Error).message}`,
    };
  }
}
