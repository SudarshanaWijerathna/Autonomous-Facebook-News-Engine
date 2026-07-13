/**
 * Config loader — reads rules.json and sources.json once at startup.
 * Never import config files directly elsewhere; always go through this module
 * so there's one place to add validation.
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { Rules, Source } from './types.js';

// Load local .env file if it exists (for local development/testing)
try {
  // process.loadEnvFile is available in Node 20.12.0+
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile();
  }
} catch (error) {
  // Ignore error if .env doesn't exist (e.g. in GitHub Actions)
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, '..', 'config');

function loadJson<T>(filename: string): T {
  const filePath = join(CONFIG_DIR, filename);
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`Failed to load config file "${filename}": ${(err as Error).message}`);
  }
}

let _rules: Rules | null = null;
let _sources: Source[] | null = null;

export function getRules(): Rules {
  if (!_rules) {
    _rules = loadJson<Rules>('rules.json');
  }
  return _rules;
}

export function getSources(): Source[] {
  if (!_sources) {
    _sources = loadJson<Source[]>('sources.json').filter((s) => s.enabled);
  }
  return _sources;
}

/** Required environment variables — throws early with a clear message if missing */
export function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
      `Set it in GitHub Actions Secrets or a local .env file.`
    );
  }
  return val;
}

/** Safely get an env var with a default (for optional secrets) */
export function getEnv(name: string, defaultValue = ''): string {
  return process.env[name] ?? defaultValue;
}

/** Current time in Sri Lanka (UTC+5:30), as a Date object */
export function nowInSriLanka(): Date {
  // JavaScript Dates are always UTC internally.
  // To get Sri Lanka "wall clock" hour, add 5h30m.
  const utcMs = Date.now();
  const sriLankaOffsetMs = 5.5 * 60 * 60 * 1000;
  return new Date(utcMs + sriLankaOffsetMs);
}

/** Hour-of-day in Sri Lanka time (0–23) */
export function sriLankaHour(): number {
  return nowInSriLanka().getUTCHours();
}

/** Today's date key in YYYY-MM-DD format (Sri Lanka time) */
export function todayKey(): string {
  const d = nowInSriLanka();
  return d.toISOString().slice(0, 10);
}

/** Is this considered the "last cycle" of the day (after 21:00 SL time)?
 *  Used to decide whether to apply graceful-degradation threshold. */
export function isLastCycleOfDay(): boolean {
  return sriLankaHour() >= 21;
}

/** Sleep for N milliseconds */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
