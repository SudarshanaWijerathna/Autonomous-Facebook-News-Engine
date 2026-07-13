/**
 * BriefSphere Autonomous Facebook News Engine — Pipeline Entrypoint
 *
 * Runs the full 9-step pipeline:
 *   [1] Discover    → RSS + scraper fallback per source
 *   [2] Normalize   → hash, excerpt cleaning (done by discover adapters)
 *   [3] Dedupe      → exact hash + cross-source similarity
 *   [4] Score       → Gemini scoring + caption (same call)
 *   [5] Select      → quality gate + category caps + pacing
 *   [6] Image       → AI generation (Cloudflare → Pollinations → static fallback)
 *   [7] Flyer       → Satori overlay + Sharp composite → PNG
 *   [8] Caption     → post-process, validate, clean
 *   [9] Publish     → Graph API + memory record
 *
 * Each story is processed in isolation — one failure never crashes others.
 * Shadow mode (rules.json: shadowMode: true) runs the full pipeline but
 * skips the publish step. Use for initial validation.
 */

import { getRules, getSources, todayKey, isLastCycleOfDay } from './config.js';
import { createRunLogger } from './log/index.js';
import { sendAlert } from './alerts/index.js';
import {
  loadMemory,
  saveMemory,
  getCategoryCountsSince,
  getWeeklyCount,
  getDailyCount,
  loadCategoryWeights,
} from './memory/index.js';
import { discoverAll } from './discover/index.js';
import { dedupeFilter } from './dedupe/index.js';
import { scoreAll } from './score/index.js';
import { selectStories } from './score/select.js';
import { generateImage } from './image/index.js';
import { renderFlyer } from './flyer/index.js';
import { processCaption } from './caption/index.js';
import { checkTokenHealth } from './publish/token-health.js';
import { publishToFacebook } from './publish/index.js';
import type { MemoryEntry } from './types.js';

async function runPipeline(): Promise<void> {
  const log = createRunLogger();

  try {
    // ── Load config ──────────────────────────────────────────────────────────
    const rules = getRules();
    const sources = getSources();
    log.shadowMode = rules.shadowMode;

    log.info(`Pipeline config: shadowMode=${rules.shadowMode}, paused=${rules.paused}`);

    // ── Kill switch check ────────────────────────────────────────────────────
    if (rules.paused) {
      log.info('Pipeline is paused (rules.json → paused: true). Exiting.');
      log.save();
      return;
    }

    // ── Token health check (early, before expensive work) ───────────────────
    let tokenOk = false;
    if (!rules.shadowMode) {
      const tokenHealth = await checkTokenHealth(rules.facebook.graphApiVersion);
      tokenOk = tokenHealth.valid;

      if (!tokenOk) {
        log.warn(`Token health check failed: ${tokenHealth.reason}`);
        await sendAlert({
          stage: 'token-health',
          message: tokenHealth.reason ?? 'Token invalid',
          runId: log.runId,
        });
        log.info('Continuing in effective shadow mode (token invalid — publish step skipped)');
      } else {
        log.info('Token health: ✓ valid');
      }
    } else {
      log.info('Shadow mode: token health check skipped');
    }

    // ── Load memory state ────────────────────────────────────────────────────
    const memory = loadMemory();
    const categoryWeights = loadCategoryWeights();

    // ── Daily / weekly budget checks ─────────────────────────────────────────
    const today = todayKey();
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    // Shift to start of today in SL time
    const startOfTodaySL = new Date(startOfToday.getTime() - 5.5 * 60 * 60 * 1000);

    const dailyCategoryCount = getCategoryCountsSince(memory, startOfTodaySL);
    const dailyTotalCount = getDailyCount(memory, today);
    const weeklyCount = getWeeklyCount(memory);
    const isLastCycle = isLastCycleOfDay();

    log.info(`Pacing: today=${dailyTotalCount} posts, week=${weeklyCount}/${rules.pacing.weeklyTarget}`);

    if (weeklyCount >= rules.pacing.weeklyTarget * 1.2) {
      log.info('Weekly target exceeded (120% ceiling). Skipping run.');
      log.save();
      return;
    }

    // ── Step 1: Discover ─────────────────────────────────────────────────────
    log.info(`Discovering from ${sources.length} sources...`);
    const rawStories = await discoverAll(sources, rules.memory.dedupeHashWords);
    log.discovered = rawStories.length;
    log.info(`Discovered: ${rawStories.length} raw stories`);

    if (rawStories.length === 0) {
      log.warn('No stories discovered this run');
      log.save();
      return;
    }

    // ── Steps 2–3: Dedupe ────────────────────────────────────────────────────
    const { kept, skipped: dedupSkipped } = dedupeFilter(rawStories, memory, {
      crossSourceSimilarityThreshold: rules.memory.crossSourceSimilarityThreshold,
      crossSourceTimeWindowHours: rules.memory.crossSourceTimeWindowHours,
    });
    log.afterDedup = kept.length;

    for (const { story, reason } of dedupSkipped) {
      log.skipStory(story.url, story.headline, reason);
    }
    log.info(`After dedup: ${kept.length} stories`);

    if (kept.length === 0) {
      log.info('All stories were duplicates. No new content this run.');
      log.save();
      return;
    }

    // ── Step 4: Score + Caption ──────────────────────────────────────────────
    log.info(`Scoring ${kept.length} stories via Gemini (${rules.gemini.model})...`);
    const { scored, failed: scoreFailed } = await scoreAll(
      kept,
      rules.gemini.model,
      rules.imageStyle,
      rules.gemini.maxRetries
    );
    log.scored = scored.length;

    for (const story of scoreFailed) {
      log.recordError('score', 'Gemini scoring failed after retries', story.url);
      await sendAlert({ stage: 'score', headline: story.headline, message: 'Scoring failed after retries', runId: log.runId });
    }

    // ── Step 5: Select ───────────────────────────────────────────────────────
    const { selected, rejections, thresholdUsed, gracefulDegradationApplied } = selectStories(scored, {
      publishThreshold: rules.scoring.publishThreshold,
      gracefulDegradationThreshold: rules.scoring.gracefulDegradationThreshold,
      breakingThreshold: rules.scoring.breakingThreshold,
      isLastCycleOfDay: isLastCycle,
      dailyMinimum: rules.pacing.dailyMinimum,
      categoryCapsDailyMax: rules.categoryCapsDailyMax,
      maxPostsPerRun: rules.pacing.maxPostsPerRun,
      dailyCategoryCount,
      dailyTotalCount,
      weeklyCount,
      weeklyTarget: rules.pacing.weeklyTarget,
      categoryWeights,
    });

    log.selected = selected.length;

    if (gracefulDegradationApplied) {
      log.warn(`Graceful degradation applied (threshold lowered to ${thresholdUsed})`);
    }

    for (const { story, reason } of rejections) {
      log.skipStory(story.url, story.headline, reason, story.score);
    }

    if (selected.length === 0) {
      log.info('No stories passed the quality gate this run.');
      log.save();
      return;
    }

    log.info(`Selected ${selected.length} stories to publish`);

    // ── Steps 6–9: Process each selected story ───────────────────────────────
    for (const story of selected) {
      log.info(`Processing: "${story.headline.slice(0, 70)}" (score=${story.score})`);

      try {
        // Step 6: Generate background image
        log.info('  [6] Generating image...');
        const imageResult = await generateImage(story, rules.imageStyle);
        log.info(`  [6] Image ready (${imageResult.provider})`);

        // Step 7: Render flyer
        log.info('  [7] Rendering flyer...');
        const flyerBuffer = await renderFlyer(story, imageResult.buffer);
        log.info(`  [7] Flyer ready (${(flyerBuffer.length / 1024).toFixed(0)} KB)`);

        // Step 8: Process caption
        log.info('  [8] Processing caption...');
        const caption = processCaption(story.captionDraft, story.sourceName);

        // Step 9: Publish or log (shadow mode)
        let fbPostId: string;

        if (rules.shadowMode || !tokenOk) {
          const mode = rules.shadowMode ? 'shadowMode' : 'tokenInvalid';
          log.info(`  [9] SHADOW — would publish (${mode})`);
          log.info(`  Caption preview:\n${caption.slice(0, 300)}...`);
          fbPostId = 'shadow';
        } else {
          log.info('  [9] Publishing to Facebook...');
          fbPostId = await publishToFacebook(flyerBuffer, caption, rules.facebook.graphApiVersion);
        }

        // Record in memory
        const memEntry: MemoryEntry = {
          url: story.url,
          contentHash: story.contentHash,
          headline: story.headline,
          sourceId: story.sourceId,
          publishedAt: story.publishedAt.toISOString(),
          fbPostId,
          category: story.category,
          score: story.score,
          addedAt: new Date().toISOString(),
          isShadow: rules.shadowMode || !tokenOk,
        };
        memory.push(memEntry);
        log.published++;

        log.success(
          `✅ Story processed: "${story.headline.slice(0, 60)}" ` +
          `(post=${fbPostId}, provider=${imageResult.provider})`
        );

      } catch (err) {
        const errMsg = (err as Error).message;
        log.error(`Failed to process story: "${story.headline.slice(0, 60)}"`, err);
        log.recordError('story-processing', errMsg, story.url);

        await sendAlert({
          stage: 'story-processing',
          headline: story.headline,
          message: errMsg,
          runId: log.runId,
        });

        // Skip this story and continue — don't crash the whole run
      }
    }

    // ── Save memory (with pruning) ───────────────────────────────────────────
    saveMemory(memory, rules.memory.windowDays);
    log.info('Memory saved');

  } catch (err) {
    // Top-level crash — something fundamental broke
    const errMsg = (err as Error).message;
    log.error('PIPELINE CRASH', err);
    await sendAlert({ stage: 'pipeline-crash', message: errMsg });
    log.save();
    process.exit(1);
  }

  log.save();
}

// Run
runPipeline();
