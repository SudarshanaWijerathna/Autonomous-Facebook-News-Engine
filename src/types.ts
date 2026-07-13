// ─── Shared TypeScript types for the BriefSphere FB Engine ───────────────────
// All modules import from here. Adding a field? Add it here first.

// ── Config ───────────────────────────────────────────────────────────────────

export interface Rules {
  paused: boolean;
  shadowMode: boolean;
  scoring: {
    publishThreshold: number;
    gracefulDegradationThreshold: number;
    breakingThreshold: number;
  };
  pacing: {
    dailyMinimum: number;
    weeklyTarget: number;
    maxPostsPerRun: number;
  };
  memory: {
    windowDays: number;
    dedupeHashWords: number;
    crossSourceSimilarityThreshold: number;
    crossSourceTimeWindowHours: number;
  };
  categoryCapsDailyMax: Record<string, number>;
  feedback: {
    engagementWeightBoundPct: number;
    minPostsBeforeLearning: number;
  };
  facebook: {
    graphApiVersion: string;
  };
  gemini: {
    model: string;
    maxRetries: number;
  };
  imageStyle: string;
  schedule: {
    windows: string[];
    timezone: string;
  };
}

export interface SourceScrapeConfig {
  enabled: boolean;
  listSelector?: string;
  itemSelectors?: {
    headline: string;
    link: string;
    excerpt?: string;
    image?: string;
  };
}

export interface Source {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  rssUrls: string[];
  scrapeFallback: SourceScrapeConfig;
  userAgent: string;
}

// ── Pipeline stages ───────────────────────────────────────────────────────────

/** What the discover stage produces per story */
export interface RawStory {
  sourceId: string;
  sourceName: string;
  headline: string;
  excerpt: string;       // First ~150 words — facts only, not full body
  url: string;           // Canonical URL
  publishedAt: Date;
  heroImageUrl?: string;
  heroImageAlt?: string;
  contentHash: string;   // SHA-256 of headline + first N words
}

/** What the score stage produces (extends RawStory) */
export interface ScoredStory extends RawStory {
  score: number;          // 0-100
  category: Category;
  isBreaking: boolean;
  captionDraft: string;  // Generated in the same Gemini call as scoring
  scoreReasoning: string;
}

/** What the flyer stage produces */
export interface RenderedPost {
  story: ScoredStory;
  flyerBuffer: Buffer;   // 1080×1080 PNG
  caption: string;       // Processed, validated caption
}

// ── Memory / state ────────────────────────────────────────────────────────────

export interface MemoryEntry {
  url: string;
  contentHash: string;
  headline: string;
  sourceId: string;
  publishedAt: string;    // ISO string
  fbPostId: string;       // 'shadow' if published in shadow mode
  category: Category;
  score: number;
  addedAt: string;        // ISO string
  isShadow: boolean;      // True if published in shadow mode
}

export interface EngagementEntry {
  fbPostId: string;
  url: string;
  category: Category;
  publishedAt: string;
  hourPublished: number;  // 0-23, Sri Lanka time
  reactions: number;
  comments: number;
  shares: number;
  fetchedAt: string;
}

export interface CategoryWeights {
  [category: string]: number;  // 1.0 = neutral; adjusted by feedback loop
}

export interface TimingData {
  hourlyEngagement: {
    [hour: string]: {  // "0" through "23"
      posts: number;
      totalEngagement: number;
    };
  };
}

export interface RunSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  shadowMode: boolean;
  discovered: number;
  afterDedup: number;
  scored: number;
  selected: number;
  published: number;
  skipped: Array<{ url: string; headline: string; reason: string; score?: number }>;
  errors: Array<{ url?: string; stage: string; message: string }>;
}

// ── Categories ────────────────────────────────────────────────────────────────

export type Category =
  | 'Sri Lanka'
  | 'World'
  | 'AI & Tech'
  | 'Business'
  | 'Sports'
  | 'Breaking';

export const CATEGORIES: Category[] = [
  'Sri Lanka',
  'World',
  'AI & Tech',
  'Business',
  'Sports',
  'Breaking',
];

export const CATEGORY_COLORS: Record<Category, string> = {
  'Sri Lanka':  '#DC2626', // red
  'World':      '#2563EB', // blue
  'AI & Tech':  '#7C3AED', // purple
  'Business':   '#059669', // green
  'Sports':     '#EA580C', // orange
  'Breaking':   '#DC2626', // red (same as Sri Lanka — urgent)
};

// ── Gemini scoring response ───────────────────────────────────────────────────

export interface GeminiScoreResponse {
  score: number;
  category: Category;
  isBreaking: boolean;
  reasoning: string;
  caption: string;
}

// ── Image generation ──────────────────────────────────────────────────────────

export type ImageGenProvider = 'pollinations' | 'cloudflare' | 'fallback';

export interface ImageGenResult {
  buffer: Buffer;
  provider: ImageGenProvider;
  prompt: string;
}

// ── Flyer template variant ────────────────────────────────────────────────────

export type FlyerVariant = 'standard' | 'breaking' | 'sports' | 'sensitive';

export interface FlyerTemplateOptions {
  headline: string;
  summary: string;
  category: Category;
  categoryColor: string;
  bgImageBase64: string;  // base64-encoded 1080×1080 PNG
  variant: FlyerVariant;
}
