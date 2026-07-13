/**
 * Engagement feedback loop — daily job.
 *
 * For each published post (non-shadow) in the last 30 days:
 *   1. Fetch reactions/comments/shares from the Page Insights API
 *   2. Store in data/engagement.json
 *   3. Adjust category weights in data/category-weights.json
 *      (up/down by ≤ engagementWeightBoundPct per cycle)
 *   4. Update hour-of-day performance in data/timing.json
 *
 * Runs as a separate GitHub Actions job (engagement-sync.yml) once daily.
 * Requires the same FB_SYSTEM_USER_TOKEN as the main pipeline.
 *
 * This module is intentionally conservative — each adjustment is small and bounded
 * so one viral outlier doesn't whipsaw the whole system.
 */

import { requireEnv } from '../config.js';
import {
  loadMemory,
  loadEngagement,
  saveEngagement,
  loadCategoryWeights,
  saveCategoryWeights,
  loadTimingData,
  saveTimingData,
} from '../memory/index.js';
import { getRules } from '../config.js';
import type { EngagementEntry } from '../types.js';

interface InsightsValue {
  value: number;
}

interface InsightsData {
  id: string;
  name: string;
  values?: InsightsValue[];
}



/** Fetch engagement metrics for one post from the Graph API */
async function fetchPostInsights(
  postId: string,
  accessToken: string,
  apiVersion: string
): Promise<{ reactions: number; comments: number; shares: number } | null> {
  const url = new URL(`https://graph.facebook.com/${apiVersion}/${postId}`);
  url.searchParams.set('fields', 'reactions.summary(total_count),comments.summary(total_count),shares');
  url.searchParams.set('access_token', accessToken);

  try {
    const res = await fetch(url.href, { signal: AbortSignal.timeout(10_000) });
    const json = await res.json() as {
      reactions?: { summary?: { total_count: number } };
      comments?: { summary?: { total_count: number } };
      shares?: { count: number };
      error?: { message: string };
    };

    if (!res.ok || json.error) {
      console.warn(`[feedback] Post ${postId}: ${json.error?.message ?? 'HTTP ' + res.status}`);
      return null;
    }

    return {
      reactions: json.reactions?.summary?.total_count ?? 0,
      comments: json.comments?.summary?.total_count ?? 0,
      shares: json.shares?.count ?? 0,
    };

  } catch (err) {
    console.warn(`[feedback] Post ${postId} fetch failed: ${(err as Error).message}`);
    return null;
  }
}

/** Calculate a simple engagement score for weighting */
function engagementScore(entry: EngagementEntry): number {
  // Shares count more than reactions; comments in between
  return entry.reactions + entry.comments * 2 + entry.shares * 3;
}

/** Adjust category weights based on recent engagement, bounded by ±boundPct */
function adjustCategoryWeights(
  entries: EngagementEntry[],
  currentWeights: Record<string, number>,
  boundPct: number,
  minPosts: number
): Record<string, number> {
  const adjustment = boundPct / 100;
  const updated = { ...currentWeights };

  // Group by category
  const byCategory = new Map<string, EngagementEntry[]>();
  for (const entry of entries) {
    const list = byCategory.get(entry.category) ?? [];
    list.push(entry);
    byCategory.set(entry.category, list);
  }

  // Calculate average engagement per category
  const categoryAvgEngagement = new Map<string, number>();
  let totalAvg = 0;
  let catCount = 0;

  for (const [cat, catEntries] of byCategory) {
    if (catEntries.length < 2) continue;  // Need at least 2 data points
    const avg = catEntries.reduce((sum, e) => sum + engagementScore(e), 0) / catEntries.length;
    categoryAvgEngagement.set(cat, avg);
    totalAvg += avg;
    catCount++;
  }

  if (catCount === 0) {
    console.log('[feedback] Not enough data for weight adjustment');
    return updated;
  }

  const overallAvg = totalAvg / catCount;

  // Nudge weights
  for (const [cat, avg] of categoryAvgEngagement) {
    const relative = avg / overallAvg;  // > 1 = above average, < 1 = below

    if (relative > 1.1) {
      // Above average — nudge weight up
      updated[cat] = Math.min(2.0, (updated[cat] ?? 1.0) + adjustment);
      console.log(`[feedback] ${cat}: weight ↑ to ${updated[cat].toFixed(2)} (avg engagement ${avg.toFixed(0)} vs overall ${overallAvg.toFixed(0)})`);
    } else if (relative < 0.9) {
      // Below average — nudge weight down
      updated[cat] = Math.max(0.3, (updated[cat] ?? 1.0) - adjustment);
      console.log(`[feedback] ${cat}: weight ↓ to ${updated[cat].toFixed(2)} (avg engagement ${avg.toFixed(0)} vs overall ${overallAvg.toFixed(0)})`);
    }
  }

  return updated;
}

/** Update hour-of-day timing data from engagement entries */
function updateTimingData(
  entries: EngagementEntry[],
  existing: ReturnType<typeof loadTimingData>
): ReturnType<typeof loadTimingData> {
  const updated = { ...existing };

  for (const entry of entries) {
    const hour = String(entry.hourPublished);
    const current = updated.hourlyEngagement[hour] ?? { posts: 0, totalEngagement: 0 };
    const score = engagementScore(entry);

    updated.hourlyEngagement[hour] = {
      posts: current.posts + 1,
      totalEngagement: current.totalEngagement + score,
    };
  }

  return updated;
}

/** Get hour of day in Sri Lanka time from an ISO timestamp */
function sriLankaHourFromIso(isoStr: string): number {
  const utcMs = new Date(isoStr).getTime();
  const slMs = utcMs + 5.5 * 60 * 60 * 1000;
  return new Date(slMs).getUTCHours();
}

export async function runFeedbackSync(): Promise<void> {
  console.log('[feedback] Starting engagement sync...');

  const rules = getRules();
  const accessToken = requireEnv('FB_SYSTEM_USER_TOKEN');
  const apiVersion = rules.facebook.graphApiVersion;
  const boundPct = rules.feedback.engagementWeightBoundPct;
  const minPosts = rules.feedback.minPostsBeforeLearning;

  // Load data
  const memory = loadMemory();
  const existingEngagement = loadEngagement();

  // Only check posts from the last 30 days
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentPosts = memory.filter(
    (e) => !e.isShadow && e.fbPostId !== 'shadow' && new Date(e.addedAt) > cutoff
  );

  console.log(`[feedback] Checking ${recentPosts.length} recent posts for engagement data`);

  const newEntries: EngagementEntry[] = [];

  for (const post of recentPosts) {
    // Skip if we already have up-to-date data (fetched in the last 24h)
    const existing = existingEngagement.find((e) => e.fbPostId === post.fbPostId);
    if (existing) {
      const fetchedAt = new Date(existing.fetchedAt);
      const hoursAgo = (Date.now() - fetchedAt.getTime()) / 3_600_000;
      if (hoursAgo < 20) {
        // Already fresh — skip
        continue;
      }
    }

    const metrics = await fetchPostInsights(post.fbPostId, accessToken, apiVersion);
    if (!metrics) continue;

    const entry: EngagementEntry = {
      fbPostId: post.fbPostId,
      url: post.url,
      category: post.category,
      publishedAt: post.addedAt,
      hourPublished: sriLankaHourFromIso(post.addedAt),
      reactions: metrics.reactions,
      comments: metrics.comments,
      shares: metrics.shares,
      fetchedAt: new Date().toISOString(),
    };

    newEntries.push(entry);
    console.log(
      `[feedback] ${post.headline.slice(0, 50)}: ` +
      `❤️ ${metrics.reactions} | 💬 ${metrics.comments} | 🔁 ${metrics.shares}`
    );

    // Brief delay to be polite to the API
    await new Promise((r) => setTimeout(r, 500));
  }

  // Merge and save engagement data
  const allEngagement = [
    ...existingEngagement.filter((e) => !newEntries.find((n) => n.fbPostId === e.fbPostId)),
    ...newEntries,
  ];
  saveEngagement(allEngagement);
  console.log(`[feedback] Saved ${allEngagement.length} engagement entries`);

  // Only adjust weights if we have enough data
  if (allEngagement.length < minPosts) {
    console.log(`[feedback] Need ${minPosts} posts minimum for weight adjustment (have ${allEngagement.length}) — skipping`);
    return;
  }

  // Adjust category weights
  const currentWeights = loadCategoryWeights();
  const updatedWeights = adjustCategoryWeights(
    allEngagement.slice(-60),  // Use last 60 data points
    currentWeights,
    boundPct,
    minPosts
  );
  saveCategoryWeights(updatedWeights);

  // Update timing data
  const timingData = loadTimingData();
  const updatedTiming = updateTimingData(newEntries, timingData);
  saveTimingData(updatedTiming);

  // Log best performing hours
  const hourlyData = updatedTiming.hourlyEngagement;
  const hoursSorted = Object.entries(hourlyData)
    .filter(([, d]) => d.posts >= 3)
    .map(([hour, d]) => ({ hour: parseInt(hour), avg: d.totalEngagement / d.posts }))
    .sort((a, b) => b.avg - a.avg);

  if (hoursSorted.length > 0) {
    const best = hoursSorted[0];
    console.log(`[feedback] Best performing hour: ${best.hour}:00 SL time (avg score ${best.avg.toFixed(0)})`);
  }

  console.log('[feedback] ✅ Engagement sync complete');
}

// Allow running directly: tsx src/feedback/sync.ts
runFeedbackSync().catch((err) => {
  console.error('[feedback] Sync failed:', err);
  process.exit(1);
});
