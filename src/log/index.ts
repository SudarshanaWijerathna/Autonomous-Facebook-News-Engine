/**
 * Structured run logger.
 *
 * Writes to stdout (visible in GitHub Actions logs) with ISO timestamps
 * and a structured JSON summary saved to data/latest-run.json at the end.
 * Detailed per-run JSONL logs are written to stdout only (not committed to git).
 */

import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import type { RunSummary } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');

export type LogLevel = 'info' | 'success' | 'warn' | 'error';

const LEVEL_ICONS: Record<LogLevel, string> = {
  info:    '📰',
  success: '✅',
  warn:    '⚠️ ',
  error:   '❌',
};

export class RunLogger {
  readonly runId: string;
  readonly startedAt: Date;
  private lines: string[] = [];

  // Accumulate for final summary
  discovered = 0;
  afterDedup = 0;
  scored = 0;
  selected = 0;
  published = 0;
  shadowMode = false;
  skipped: RunSummary['skipped'] = [];
  errors: RunSummary['errors'] = [];

  constructor() {
    this.runId = randomUUID().slice(0, 8);
    this.startedAt = new Date();
    this.log('info', `Run ${this.runId} started — ${this.startedAt.toISOString()}`);
  }

  log(level: LogLevel, message: string, extra?: Record<string, unknown>): void {
    const ts = new Date().toISOString();
    const icon = LEVEL_ICONS[level];
    const extraStr = extra ? ` ${JSON.stringify(extra)}` : '';
    const line = `[${ts}] ${icon} ${message}${extraStr}`;
    this.lines.push(line);

    // Write to stdout immediately so GitHub Actions shows progress in real time
    if (level === 'error') {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  info(msg: string, extra?: Record<string, unknown>): void {
    this.log('info', msg, extra);
  }

  success(msg: string, extra?: Record<string, unknown>): void {
    this.log('success', msg, extra);
  }

  warn(msg: string, extra?: Record<string, unknown>): void {
    this.log('warn', msg, extra);
  }

  error(msg: string, err?: unknown, extra?: Record<string, unknown>): void {
    const errMsg = err instanceof Error ? err.message : String(err ?? '');
    this.log('error', msg, { error: errMsg, ...extra });
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
  }

  skipStory(url: string, headline: string, reason: string, score?: number): void {
    this.skipped.push({ url, headline, reason, score });
    this.info(`Skipped: "${headline.slice(0, 60)}" — ${reason}`, { score });
  }

  recordError(stage: string, message: string, url?: string): void {
    this.errors.push({ url, stage, message });
  }

  /** Save the final summary to data/latest-run.json and print it */
  save(): void {
    const finishedAt = new Date();
    const duration = ((finishedAt.getTime() - this.startedAt.getTime()) / 1000).toFixed(1);

    const summary: RunSummary = {
      runId: this.runId,
      startedAt: this.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      shadowMode: this.shadowMode,
      discovered: this.discovered,
      afterDedup: this.afterDedup,
      scored: this.scored,
      selected: this.selected,
      published: this.published,
      skipped: this.skipped,
      errors: this.errors,
    };

    const summaryStr = JSON.stringify(summary, null, 2);
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Run ${this.runId} complete in ${duration}s`);
    console.log(`  Discovered: ${this.discovered} | After dedup: ${this.afterDedup} | Published: ${this.published}`);
    if (this.shadowMode) console.log('  ⚠️  SHADOW MODE — nothing was published to Facebook');
    if (this.errors.length > 0) console.log(`  Errors: ${this.errors.length}`);
    console.log(`${'─'.repeat(60)}\n`);

    try {
      mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(join(DATA_DIR, 'latest-run.json'), summaryStr, 'utf-8');
    } catch (err) {
      console.error('Failed to save run summary:', err);
    }
  }
}

/** Singleton-per-run logger — call createRunLogger() once at the start of pipeline.ts */
let _logger: RunLogger | null = null;

export function createRunLogger(): RunLogger {
  _logger = new RunLogger();
  return _logger;
}

export function getLogger(): RunLogger {
  if (!_logger) throw new Error('Logger not initialized. Call createRunLogger() first.');
  return _logger;
}
