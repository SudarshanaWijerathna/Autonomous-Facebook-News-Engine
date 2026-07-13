/**
 * Alert module — sends failure notifications to a Discord or Telegram webhook.
 *
 * Auto-detects the webhook type from the URL:
 *   Discord  → https://discord.com/api/webhooks/...
 *   Telegram → https://api.telegram.org/bot.../sendMessage  (chat_id also needed)
 *
 * Alert failures are ALWAYS swallowed — a broken alert must never crash the pipeline.
 * The alert is best-effort; the primary signal is the GitHub Actions run log.
 */

import { getEnv } from '../config.js';

export interface AlertPayload {
  stage: string;         // e.g. "discover", "score", "publish"
  headline?: string;
  message: string;
  runId?: string;
}

function buildDiscordBody(p: AlertPayload): string {
  const lines = [
    `🚨 **BriefSphere Pipeline Alert**`,
    `**Stage:** ${p.stage}`,
    p.headline ? `**Story:** ${p.headline.slice(0, 100)}` : null,
    `**Error:** ${p.message.slice(0, 400)}`,
    p.runId ? `**Run:** \`${p.runId}\`` : null,
  ].filter(Boolean);

  return JSON.stringify({ content: lines.join('\n') });
}

function buildTelegramBody(p: AlertPayload, chatId: string): string {
  const lines = [
    `🚨 BriefSphere Pipeline Alert`,
    `Stage: ${p.stage}`,
    p.headline ? `Story: ${p.headline.slice(0, 100)}` : null,
    `Error: ${p.message.slice(0, 400)}`,
    p.runId ? `Run: ${p.runId}` : null,
  ].filter(Boolean);

  return JSON.stringify({
    chat_id: chatId,
    text: lines.join('\n'),
    parse_mode: 'HTML',
  });
}

export async function sendAlert(payload: AlertPayload): Promise<void> {
  const webhookUrl = getEnv('ALERT_WEBHOOK_URL');

  if (!webhookUrl) {
    console.warn('[alerts] ALERT_WEBHOOK_URL not set — skipping alert notification');
    return;
  }

  try {
    let body: string;
    let url: string;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (webhookUrl.includes('discord.com/api/webhooks')) {
      // Discord
      body = buildDiscordBody(payload);
      url = webhookUrl;
    } else if (webhookUrl.includes('api.telegram.org')) {
      // Telegram — expects TELEGRAM_CHAT_ID as a separate env var
      const chatId = getEnv('TELEGRAM_CHAT_ID');
      if (!chatId) {
        console.warn('[alerts] TELEGRAM_CHAT_ID not set for Telegram webhook');
        return;
      }
      body = buildTelegramBody(payload, chatId);
      url = webhookUrl;
    } else {
      // Generic webhook — POST JSON with the message
      body = JSON.stringify({
        text: `🚨 BriefSphere [${payload.stage}]: ${payload.message}`,
        headline: payload.headline,
        runId: payload.runId,
      });
      url = webhookUrl;
    }

    const res = await fetch(url, { method: 'POST', headers, body });

    if (!res.ok) {
      console.warn(`[alerts] Webhook returned ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    // Never throw from an alert failure — log to stderr and move on
    console.error('[alerts] Failed to send alert (this is non-fatal):', err);
  }
}

/** Convenience wrapper for a simple error string */
export async function alertError(stage: string, err: unknown, headline?: string, runId?: string): Promise<void> {
  const message = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  await sendAlert({ stage, message, headline, runId });
}
