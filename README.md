# BriefSphere — Autonomous Facebook News Engine

An unattended pipeline that discovers Sri Lankan news, generates branded AI flyer images, writes original captions, and publishes to the BriefSphere Facebook Page — several times a day, indefinitely.

```
[Scheduler / Heartbeat]
        │
        ▼
[1] Discover      → RSS feeds (scraper fallback per source)
        ▼
[2] Dedupe        → exact hash + cross-source headline similarity
        ▼
[3] Score         → Gemini 0–100 importance score + caption (single API call)
        ▼
[4] Select        → quality gate + category caps + pacing budget
        ▼
[5] Generate      → AI illustration (Cloudflare → Pollinations → static fallback)
        ▼
[6] Render        → 1080×1080 flyer (Satori overlay + Sharp composite)
        ▼
[7] Caption       → validate, clean, ensure attribution + hashtags
        ▼
[8] Publish       → Facebook Graph API v25.0
        ▼
[9] Record        → memory.json committed back to repo
```

---

## Repository layout

```
├── .github/workflows/
│   ├── heartbeat.yml         # scheduled trigger, 8×/day
│   └── engagement-sync.yml   # daily insights pull
├── src/
│   ├── pipeline.ts           # main orchestrator
│   ├── config.ts             # config loader + time utilities
│   ├── types.ts              # all shared TypeScript types
│   ├── discover/             # RSS + scraper adapters
│   ├── dedupe/               # hash + similarity dedup
│   ├── score/                # Gemini scoring + story selection
│   ├── image/                # AI image generation (Cloudflare / Pollinations)
│   ├── flyer/                # Satori + Sharp flyer renderer
│   ├── caption/              # caption post-processing
│   ├── publish/              # Facebook Graph API client + token health
│   ├── feedback/             # engagement sync + weight tuning
│   ├── memory/               # JSON store read/write
│   ├── alerts/               # Discord / Telegram webhook
│   └── log/                  # run logger
├── config/
│   ├── rules.json            # ALL tunable thresholds (edit here, not in code)
│   └── sources.json          # per-source RSS URLs + scraper selectors
├── data/                     # committed state (memory, engagement, weights)
├── templates/fallback/       # static PNG fallbacks for image gen failures
└── package.json
```

---

## Setup

### 1. Prerequisites

- Node.js 22+
- A GitHub repo (public = unlimited Actions minutes; private = 2,000 min/month free)
- A Facebook Business Manager account with a Page and System User token (see §Token Setup)

### 2. Install

```bash
npm install
```

### 3. GitHub Secrets

Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Description |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio API key (free tier) |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID (optional — Pollinations used if absent) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Workers AI permission (optional) |
| `FB_PAGE_ID` | Your Facebook Page ID (numeric) |
| `FB_SYSTEM_USER_TOKEN` | Non-expiring System User access token |
| `ALERT_WEBHOOK_URL` | Discord webhook URL or Telegram Bot API URL |
| `TELEGRAM_CHAT_ID` | Chat ID for Telegram alerts (only if using Telegram) |

> **Never** commit any of these. GitHub Secrets are encrypted even in public repos.

### 4. Token Setup (read this carefully — it's the #1 failure point)

Standard Page tokens expire every 60 days. To get a **non-expiring** token:

1. Create a [Facebook Business Manager](https://business.facebook.com) account
2. Add your Page to Business Manager
3. Create a **Business-type App** in Business Manager → Settings → Apps
4. Add the app to your Page with the required permissions
5. Go to Business Manager → Settings → **System Users**
6. Create a System User with "Admin" role
7. Generate a token from the **System User settings** (not from the API explorer)
   — this token does not expire on a 60-day timer
8. Required permissions: `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`

The pipeline runs a token health check at the start of every run. If the token is revoked or invalid, it alerts you and skips publishing (doesn't crash).

---

## Running locally

```bash
# Set secrets in a .env file (never commit this)
cp .env.example .env
# Edit .env with your keys

# Run the pipeline once (shadow mode by default)
npm run pipeline

# Run the engagement sync
npm run feedback

# TypeScript check
npm run typecheck
```

---

## Configuration

**All thresholds and caps are in `config/rules.json`** — change values there, never in code.

Key settings:

| Key | Default | Description |
|---|---|---|
| `paused` | `false` | Kill switch — set to `true` to stop all publishing immediately |
| `shadowMode` | `true` | Run everything but skip the publish step (**set to false to go live**) |
| `scoring.publishThreshold` | `75` | Minimum score to publish |
| `scoring.breakingThreshold` | `92` | Score required for BREAKING category bypass |
| `pacing.dailyMinimum` | `4` | Minimum posts/day before graceful degradation kicks in |
| `pacing.weeklyTarget` | `50` | ~7/day average target |
| `pacing.maxPostsPerRun` | `2` | Cap per scheduler invocation |
| `categoryCapsDailyMax` | see file | Per-category daily post limits |

---

## Shadow mode (Phase 0)

**Shadow mode is ON by default** (`rules.json → shadowMode: true`).

In shadow mode, the pipeline runs the full 9-step pipeline — discovers stories, scores them, generates images, renders flyers, writes captions — but **skips the Facebook publish step**. Everything is logged to stdout and saved to `data/latest-run.json`.

**Recommended validation process:**
1. Push to GitHub. The Action will start running on schedule.
2. Review the Actions logs for each run over 5–7 days. Check:
   - Are scores sensible? (Should mostly be 50–80, with rare 85+ outliers)
   - Are captions original and well-written? (Check they don't copy source text)
   - Are categories assigned correctly?
   - Are the flyer images appropriate?
3. If everything looks good, set `rules.json → shadowMode: false` and push.
4. On the next run, you'll get your first real Facebook post.

> **Note**: If you want to start fresh after shadow mode (so shadow-mode stories don't block dedup when you go live), clear `data/memory.json` back to `[]` before flipping `shadowMode: false`.

---

## Adding a new news source

Edit `config/sources.json`:

```json
{
  "id": "my-source-en",
  "name": "My Source",
  "baseUrl": "https://www.mysource.lk",
  "enabled": true,
  "rssUrls": [
    "https://www.mysource.lk/feed/",
    "https://www.mysource.lk/rss.xml"
  ],
  "scrapeFallback": {
    "enabled": false
  },
  "userAgent": "BriefSphere-NewsBot/1.0 (+https://briefsphere.lk/about)"
}
```

No code changes required. RSS is tried first; if all URLs fail and `scrapeFallback.enabled: true`, the scraper runs.

---

## Free tier sustainability

| Service | Free limit | Our usage | Headroom |
|---|---|---|---|
| GitHub Actions | 2,000 min/month (private) / unlimited (public) | ~8 runs × 5 min = 40 min/day → 1,200/month | ✅ |
| Gemini flash-lite | 1,500 RPD / 15 RPM | ≤50 calls/day | ✅ |
| Cloudflare Workers AI | ~10,000 neurons/day | ~40 neurons/image × 10 = 400/day | ✅ |
| Pollinations.ai | No stated limit | Fallback only | ✅ |
| Facebook Graph API | Generous rate limits | 4–10 posts/day | ✅ |

> ⚠️ **Verify Gemini commercial-use terms** before going live. The free tier may require attribution or restrict commercial use — check [AI Studio Terms of Service](https://ai.google.dev/terms). Enabling billing at this volume costs ~$1–2/month and removes ambiguity.

---

## Monitoring & alerts

The pipeline sends an alert (Discord or Telegram) when:
- A story's processing fails at any stage
- The Facebook token fails the health check
- The entire pipeline crashes

Set `ALERT_WEBHOOK_URL` in GitHub Secrets. Discord: paste a Discord channel webhook URL. Telegram: set the Bot API URL and `TELEGRAM_CHAT_ID`.

You'll also see full logs in the GitHub Actions run UI.

---

## Extending later (out of scope for v1)

The codebase is structured so these additions are additive, not rewrites:

- **Post to the BriefSphere website**: add a step in `pipeline.ts` that POSTs to the website's `/api/posts` endpoint after publishing to Facebook. Add `WEBSITE_API_URL` and `WEBSITE_API_KEY` to secrets.
- **Sinhala / Tamil captions**: add a `captionLanguage` field to `rules.json`, pass it to the Gemini prompt.
- **Comment monitoring**: add a new `src/moderation/` module with its own workflow job.
- **Supabase upgrade**: swap `src/memory/index.ts` for Supabase Postgres queries — the interface is the same.

---

## Compliance checklist

- [ ] Captions are original — not copied or closely paraphrased from source text
- [ ] Source attribution included in every caption (`📰 Source: ...`)
- [ ] No engagement-bait phrases (enforced by `src/caption/index.ts`)
- [ ] Political coverage is factual and neutral in tone (Gemini prompt instructs this)
- [ ] Sensitive stories (accidents, deaths) use the `sensitive` flyer variant
- [ ] Hero images from sources are never used directly — only their alt/caption text is used as generation context
- [ ] `robots.txt` is checked before scraping any source
- [ ] Facebook token is a System User token (non-expiring), not a user/page token
