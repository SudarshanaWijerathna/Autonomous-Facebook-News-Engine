/**
 * Memory store — rolling JSON flat-file for dedup, state, and audit trail.
 *
 * File: data/memory.json (committed back to git by the Action after each run)
 *
 * Design notes:
 *  - Load once per pipeline run, write once at the end (not on every publish)
 *  - Prune entries older than memoryWindowDays before every save
 *  - Concurrent writes won't happen (GitHub Actions runs one job at a time per repo)
 *  - If the file is corrupt/missing, start with an empty array (fail open for memory,
 *    not for publishing)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { MemoryEntry, EngagementEntry, CategoryWeights, TimingData } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');

// ── Generic read/write helpers ────────────────────────────────────────────────

function ensureDataDir(): void {
  mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonFile<T>(filename: string, fallback: T): T {
  const filePath = join(DATA_DIR, filename);
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  } catch {
    console.warn(`[memory] Failed to parse ${filename} — starting fresh`);
    return fallback;
  }
}

function writeJsonFile<T>(filename: string, data: T): void {
  ensureDataDir();
  writeFileSync(join(DATA_DIR, filename), JSON.stringify(data, null, 2), 'utf-8');
}

// ── Memory entries ────────────────────────────────────────────────────────────

let _memory: MemoryEntry[] | null = null;

export function loadMemory(): MemoryEntry[] {
  if (!_memory) {
    _memory = readJsonFile<MemoryEntry[]>('memory.json', []);
    console.log(`[memory] Loaded ${_memory.length} entries`);
  }
  return _memory;
}

export function saveMemory(entries: MemoryEntry[], windowDays: number): void {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const pruned = entries.filter((e) => new Date(e.addedAt) > cutoff);

  if (pruned.length < entries.length) {
    console.log(`[memory] Pruned ${entries.length - pruned.length} entries older than ${windowDays} days`);
  }

  writeJsonFile('memory.json', pruned);
  _memory = pruned;
}

/** Check whether a URL or content hash already exists in memory */
export function isKnown(memory: MemoryEntry[], url: string, contentHash: string): boolean {
  return memory.some((e) => e.url === url || e.contentHash === contentHash);
}

/** Count posts published per category since a given date (for daily caps) */
export function getCategoryCountsSince(memory: MemoryEntry[], since: Date): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of memory) {
    if (new Date(entry.addedAt) > since && !entry.isShadow) {
      counts[entry.category] = (counts[entry.category] ?? 0) + 1;
    }
  }
  return counts;
}

/** Count total posts published in the last 7 days */
export function getWeeklyCount(memory: MemoryEntry[]): number {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return memory.filter((e) => new Date(e.addedAt) > cutoff && !e.isShadow).length;
}

/** Count total posts published today (Sri Lanka time) */
export function getDailyCount(memory: MemoryEntry[], todayDateKey: string): number {
  return memory.filter((e) => {
    if (e.isShadow) return false;
    // addedAt is UTC — shift to SL time for the date comparison
    const slTime = new Date(new Date(e.addedAt).getTime() + 5.5 * 60 * 60 * 1000);
    return slTime.toISOString().slice(0, 10) === todayDateKey;
  }).length;
}

/** Get all memory entries from the last N hours (for cross-source dedup window) */
export function getRecentEntries(memory: MemoryEntry[], hours: number): MemoryEntry[] {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  return memory.filter((e) => new Date(e.addedAt) > cutoff);
}

// ── Engagement data ───────────────────────────────────────────────────────────

export function loadEngagement(): EngagementEntry[] {
  return readJsonFile<EngagementEntry[]>('engagement.json', []);
}

export function saveEngagement(entries: EngagementEntry[]): void {
  // Keep only last 90 days
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const pruned = entries.filter((e) => new Date(e.publishedAt) > cutoff);
  writeJsonFile('engagement.json', pruned);
}

// ── Category weights ──────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS: CategoryWeights = {
  'Sri Lanka': 1.0,
  'World':     1.0,
  'AI & Tech': 1.0,
  'Business':  1.0,
  'Sports':    1.0,
  'Breaking':  1.0,
};

export function loadCategoryWeights(): CategoryWeights {
  return readJsonFile<CategoryWeights>('category-weights.json', { ...DEFAULT_WEIGHTS });
}

export function saveCategoryWeights(weights: CategoryWeights): void {
  writeJsonFile('category-weights.json', weights);
}

// ── Timing data ───────────────────────────────────────────────────────────────

export function loadTimingData(): TimingData {
  return readJsonFile<TimingData>('timing.json', { hourlyEngagement: {} });
}

export function saveTimingData(data: TimingData): void {
  writeJsonFile('timing.json', data);
}
