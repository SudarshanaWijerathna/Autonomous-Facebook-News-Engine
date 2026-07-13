/**
 * BriefSphere API Diagnostic Tool
 * 
 * Verifies that all configuration keys in `.env` are functional before
 * running the live automation.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Load .env manually for this test script in case environment isn't pre-loaded
function loadEnv() {
  const envPath = join(process.cwd(), '.env');
  if (existsSync(envPath)) {
    const raw = readFileSync(envPath, 'utf-8');
    raw.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const index = trimmed.indexOf('=');
      if (index === -1) return;
      const key = trimmed.slice(0, index).trim();
      const val = trimmed.slice(index + 1).trim();
      process.env[key] = val;
    });
  }
}

loadEnv();

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

async function testTelegram() {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!webhookUrl || !chatId) {
    console.log(`${colors.red}✗ Telegram Configuration Missing${colors.reset}`);
    return false;
  }

  try {
    const message = `🚀 *BriefSphere Engine Connection Diagnostic*\n\nYour alert system connection is working successfully! Ready to automate.`;
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown'
      })
    });

    if (res.ok) {
      console.log(`${colors.green}✓ Telegram Alert System: Connection successful! Message sent.${colors.reset}`);
      return true;
    } else {
      const errJson = await res.json() as any;
      const desc = errJson?.description || '';
      if (desc.includes('chat not found')) {
        console.log(`${colors.red}✗ Telegram Alert System Failed: Chat not found. You must search for your bot on Telegram and click 'Start' first!${colors.reset}`);
      } else {
        console.log(`${colors.red}✗ Telegram Alert System Failed: HTTP ${res.status} - ${JSON.stringify(errJson)}${colors.reset}`);
      }
      return false;
    }
  } catch (err) {
    console.log(`${colors.red}✗ Telegram Alert System Error: ${(err as Error).message}${colors.reset}`);
    return false;
  }
}

async function testGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log(`${colors.red}✗ Gemini API Key Missing${colors.reset}`);
    return false;
  }

  try {
    const ai = new GoogleGenerativeAI(apiKey);
    const model = ai.getGenerativeModel({ model: 'gemini-flash-latest' });
    const result = await model.generateContent('Say: Gemini connection verified');
    const text = result.response.text();
    console.log(`${colors.green}✓ Google Gemini API: Connection successful! Response: "${text.trim()}"${colors.reset}`);
    return true;
  } catch (err) {
    console.log(`${colors.red}✗ Google Gemini API Failed: ${(err as Error).message}${colors.reset}`);
    return false;
  }
}

async function testCloudflare() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    console.log(`${colors.yellow}! Cloudflare Credentials Missing (Falling back to Pollinations.ai)${colors.reset}`);
    return true; // Optional, fallback exists
  }

  try {
    // Model used in image/index.ts
    const model = '@cf/black-forest-labs/flux-1-schnell';
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
    
    // We send a dry prompt just to see if we get authenticated/response
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prompt: 'test connection' })
    });

    if (res.ok) {
      console.log(`${colors.green}✓ Cloudflare Workers AI: Connection successful! Authenticated correctly.${colors.reset}`);
      return true;
    } else {
      const errJson = await res.json() as any;
      const errMsg = errJson?.errors?.[0]?.message || 'Unknown error';
      console.log(`${colors.red}✗ Cloudflare Workers AI Failed: HTTP ${res.status} - ${errMsg}${colors.reset}`);
      return false;
    }
  } catch (err) {
    console.log(`${colors.red}✗ Cloudflare Workers AI Error: ${(err as Error).message}${colors.reset}`);
    return false;
  }
}

async function testFacebook() {
  const pageId = process.env.FB_PAGE_ID;
  const pageToken = process.env.FB_SYSTEM_USER_TOKEN;

  if (!pageId || !pageToken) {
    console.log(`${colors.red}✗ Facebook Credentials Missing${colors.reset}`);
    return false;
  }

  try {
    // Querying basic page profile info
    const url = `https://graph.facebook.com/v20.0/${pageId}?fields=name,username,link&access_token=${pageToken}`;
    const res = await fetch(url);
    const json = await res.json() as any;

    if (res.ok && !json.error) {
      console.log(`${colors.green}✓ Facebook Graph API: Connection successful! Connected to Page: "${json.name}" (${json.link})${colors.reset}`);
      return true;
    } else {
      const errMsg = json?.error?.message || 'Unknown Graph API error';
      console.log(`${colors.red}✗ Facebook Graph API Failed: ${errMsg}${colors.reset}`);
      return false;
    }
  } catch (err) {
    console.log(`${colors.red}✗ Facebook Graph API Error: ${(err as Error).message}${colors.reset}`);
    return false;
  }
}

async function main() {
  console.log(`\n${colors.bold}🔍 BriefSphere API Diagnostic Check${colors.reset}`);
  console.log(`========================================`);

  const telegramOk = await testTelegram();
  const geminiOk = await testGemini();
  const cloudflareOk = await testCloudflare();
  const facebookOk = await testFacebook();

  console.log(`========================================`);
  if (telegramOk && geminiOk && cloudflareOk && facebookOk) {
    console.log(`${colors.bold}${colors.green}🎉 ALL DIAGNOSTICS PASSED! Ready for automation.${colors.reset}\n`);
  } else {
    console.log(`${colors.bold}${colors.yellow}⚠️ Some checks failed. Please check the logs above.${colors.reset}\n`);
  }
}

main();
