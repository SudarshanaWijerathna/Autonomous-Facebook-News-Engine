/**
 * Flyer preview script — generates a real 1080×1080 PNG using the actual pipeline.
 *
 * Usage:
 *   npm run preview
 *   npm run preview -- --variant breaking --headline "Your headline here"
 *
 * Output: tools/preview-output.png
 *
 * Does NOT need API keys — uses a solid gradient as the background
 * so you can validate the layout without calling Cloudflare or Pollinations.
 */

import sharp from 'sharp';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { renderFlyer } from '../src/flyer/index.js';
import type { ScoredStory, Category } from '../src/types.js';
import { CATEGORY_COLORS } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, 'preview-output.png');

// ── Parse CLI args ────────────────────────────────────────────────────────────
function getArg(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

type Variant = 'standard' | 'breaking' | 'sports' | 'sensitive';

const VARIANTS: Variant[] = ['standard', 'breaking', 'sports', 'sensitive'];

const headline  = getArg('--headline',  'Heavy rains triggers flood warnings across western province');
const summary   = getArg('--summary',   'The department of meteorology has issued urgent flood alerts as river levels rise across several districts, with residents in low-lying areas urged to evacuate.');
const category  = getArg('--category',  'Sri Lanka') as Category;
const variantIn = getArg('--variant',   'standard') as Variant;
const variant   = VARIANTS.includes(variantIn) ? variantIn : 'standard';

// ── Build a mock ScoredStory ──────────────────────────────────────────────────
const mockStory: ScoredStory = {
  sourceId:      'preview',
  sourceName:    'Preview Tool',
  headline,
  excerpt:       summary,
  url:           'https://example.com/preview',
  publishedAt:   new Date(),
  heroImageUrl:  undefined,
  heroImageAlt:  undefined,
  contentHash:   'preview-hash',
  score:         variant === 'breaking' ? 95 : 78,
  category,
  isBreaking:    variant === 'breaking',
  captionDraft:  `${headline}\n\n${summary}\n\n📰 Source: Preview Tool\n\n#BriefSphere #${category.replace(/\s/g, '')} #SriLanka`,
  scoreReasoning: 'Preview mode — no real scoring',
};

// ── Generate a solid gradient background (no API key needed) ──────────────────
async function generateGradientBackground(): Promise<Buffer> {
  const color = CATEGORY_COLORS[category] ?? '#DC2626';

  // Create a 1080×1080 gradient using an SVG
  const svg = `
    <svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0f172a"/>
          <stop offset="60%" stop-color="#1e2a3a"/>
          <stop offset="100%" stop-color="${color}22"/>
        </linearGradient>
        <radialGradient id="r" cx="70%" cy="30%" r="60%">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.12"/>
          <stop offset="100%" stop-color="transparent"/>
        </radialGradient>
      </defs>
      <rect width="1080" height="1080" fill="url(#g)"/>
      <rect width="1080" height="1080" fill="url(#r)"/>
    </svg>
  `;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('\n🖼  BriefSphere Flyer Preview Generator');
  console.log('━'.repeat(50));
  console.log(`  Variant:  ${variant}`);
  console.log(`  Category: ${category}`);
  console.log(`  Headline: ${headline.slice(0, 60)}${headline.length > 60 ? '…' : ''}`);
  console.log('━'.repeat(50));

  try {
    // Generate/Load background
    let bgBuffer: Buffer;
    const extractedBgPath = join(process.cwd(), 'extracted_bg.png');
    
    if (existsSync(extractedBgPath)) {
      process.stdout.write('  [1/2] Loading extracted background image... ');
      bgBuffer = readFileSync(extractedBgPath);
    } else {
      process.stdout.write('  [1/2] Generating gradient background... ');
      bgBuffer = await generateGradientBackground();
    }
    console.log('✓');

    // Render flyer
    process.stdout.write('  [2/2] Rendering flyer template... ');
    const flyerBuffer = await renderFlyer(mockStory, bgBuffer);
    console.log('✓');

    // Save output
    mkdirSync(__dirname, { recursive: true });
    writeFileSync(OUTPUT_PATH, flyerBuffer);

    console.log('\n✅ Saved to: tools/preview-output.png');
    console.log('   Open it with your system image viewer to see the result.\n');

  } catch (err) {
    console.error('\n❌ Preview failed:', (err as Error).message);
    if ((err as Error).message.includes('font')) {
      console.error('   Tip: Font loading requires an internet connection (fetched from CDN).');
    }
    process.exit(1);
  }
}

main();
