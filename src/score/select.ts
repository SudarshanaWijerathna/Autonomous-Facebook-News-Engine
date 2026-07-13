/**
 * Story selection — applies the quality gate, category caps, and pacing rules.
 *
 * Called after scoring. Takes the full sorted list of scored stories and returns
 * the subset that should be published this run.
 *
 * Rules applied in order:
 *   1. Score must meet the threshold (normal or graceful-degradation)
 *   2. Breaking news bypasses category caps (score >= breakingThreshold only)
 *   3. Daily category caps from rules.json
 *   4. Weekly budget check
 *   5. maxPostsPerRun cap
 */

import type { ScoredStory } from '../types.js';

export interface SelectionConfig {
  publishThreshold: number;
  gracefulDegradationThreshold: number;
  breakingThreshold: number;
  isLastCycleOfDay: boolean;
  dailyMinimum: number;
  categoryCapsDailyMax: Record<string, number>;
  maxPostsPerRun: number;
  dailyCategoryCount: Record<string, number>;
  dailyTotalCount: number;
  weeklyCount: number;
  weeklyTarget: number;
  categoryWeights: Record<string, number>;
}

export interface SelectionResult {
  selected: ScoredStory[];
  rejections: Array<{ story: ScoredStory; reason: string }>;
  thresholdUsed: number;
  gracefulDegradationApplied: boolean;
}

export function selectStories(
  stories: ScoredStory[],
  config: SelectionConfig
): SelectionResult {
  const rejections: Array<{ story: ScoredStory; reason: string }> = [];
  const selected: ScoredStory[] = [];

  // ── Determine effective publish threshold ──────────────────────────────────
  const belowDailyMinimum = config.dailyTotalCount < config.dailyMinimum;
  const gracefulDegradationApplied = config.isLastCycleOfDay && belowDailyMinimum;
  const threshold = gracefulDegradationApplied
    ? config.gracefulDegradationThreshold
    : config.publishThreshold;

  if (gracefulDegradationApplied) {
    console.log(
      `[select] Graceful degradation active — threshold lowered to ${threshold} ` +
      `(daily count ${config.dailyTotalCount} < minimum ${config.dailyMinimum})`
    );
  }

  // ── Check weekly budget headroom ───────────────────────────────────────────
  const weeklyBudgetLeft = Math.max(0, config.weeklyTarget * 1.2 - config.weeklyCount);
  if (weeklyBudgetLeft === 0) {
    console.log('[select] Weekly target exceeded — no stories will be selected this run');
    return { selected: [], rejections: stories.map((s) => ({ story: s, reason: 'weekly-budget-exceeded' })), thresholdUsed: threshold, gracefulDegradationApplied };
  }

  // ── Sort by weighted score (score × category weight) ──────────────────────
  const sorted = [...stories].sort((a, b) => {
    const wA = a.score * (config.categoryWeights[a.category] ?? 1.0);
    const wB = b.score * (config.categoryWeights[b.category] ?? 1.0);
    return wB - wA;  // Descending
  });

  // Track per-category counts added this run (on top of today's existing counts)
  const runCategoryCounts: Record<string, number> = {};

  for (const story of sorted) {
    if (selected.length >= config.maxPostsPerRun) {
      rejections.push({ story, reason: 'max-posts-per-run-reached' });
      continue;
    }

    // Score threshold check
    const effectiveScore = story.isBreaking && story.score >= config.breakingThreshold
      ? story.score  // Breaking stories bypass normal category caps but still need high score
      : story.score;

    if (effectiveScore < threshold) {
      rejections.push({ story, reason: `score-below-threshold (${story.score} < ${threshold})` });
      continue;
    }

    // Category cap check (breaking news bypasses caps)
    if (!story.isBreaking || story.score < config.breakingThreshold) {
      const maxForCategory = config.categoryCapsDailyMax[story.category] ?? 1;
      const existingCount = config.dailyCategoryCount[story.category] ?? 0;
      const runCount = runCategoryCounts[story.category] ?? 0;
      const totalCount = existingCount + runCount;

      if (totalCount >= maxForCategory) {
        rejections.push({
          story,
          reason: `category-cap-reached (${story.category}: ${totalCount}/${maxForCategory} today)`,
        });
        continue;
      }
    }

    // Story passes all gates — select it
    runCategoryCounts[story.category] = (runCategoryCounts[story.category] ?? 0) + 1;
    selected.push(story);
    console.log(
      `[select] ✓ Selected: "${story.headline.slice(0, 60)}" ` +
      `(score=${story.score}, category=${story.category}${story.isBreaking ? ', BREAKING' : ''})`
    );
  }

  return { selected, rejections, thresholdUsed: threshold, gracefulDegradationApplied };
}
