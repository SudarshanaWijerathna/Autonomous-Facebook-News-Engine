/**
 * Flyer renderer — composites the final 1080×1080 PNG.
 *
 * Pipeline:
 *   1. Satori renders the overlay (badge + wordmark + gradient + text) as SVG
 *      on a fully transparent background
 *   2. @resvg/resvg-js converts the SVG to a PNG buffer
 *   3. Sharp composites: background image + overlay = final flyer
 *
 * The background image is handled entirely by Sharp, keeping it out of Satori's
 * SVG render. This gives us full CSS/image-format flexibility for the bg.
 */

import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { ScoredStory, FlyerVariant, FlyerTemplateOptions } from '../types.js';
import { CATEGORY_COLORS } from '../types.js';
import { loadFonts } from './fonts.js';
import {
  standardTemplate,
  breakingTemplate,
  sportsTemplate,
  sensitiveTemplate,
} from './templates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = join(__dirname, '..', '..', 'data', 'tmp');

const W = 1080;
const H = 1080;

/** Choose the template variant for a story */
function chooseVariant(story: ScoredStory): FlyerVariant {
  if (story.isBreaking) return 'breaking';
  if (story.category === 'Sports') return 'sports';

  // Sensitive variant for accidents, disasters, deaths (detected by keywords)
  const sensitiveKeywords = [
    'death', 'died', 'killed', 'accident', 'crash', 'flood', 'disaster',
    'tragedy', 'mourning', 'victims', 'casualties', 'fire', 'explosion',
  ];
  const headlineLower = story.headline.toLowerCase();
  if (sensitiveKeywords.some((kw) => headlineLower.includes(kw))) return 'sensitive';

  return 'standard';
}

/** Get the Satori element tree for a given variant */
function getTemplate(opts: FlyerTemplateOptions) {
  switch (opts.variant) {
    case 'breaking':  return breakingTemplate(opts);
    case 'sports':    return sportsTemplate(opts);
    case 'sensitive': return sensitiveTemplate(opts);
    default:          return standardTemplate(opts);
  }
}

/** Generate a short summary for the flyer from the caption draft */
function extractFlierSummary(captionDraft: string): string {
  // Take the first sentence that's not a hashtag line or source line
  const lines = captionDraft.split('\n').map((l) => l.trim()).filter(Boolean);
  const contentLines = lines.filter(
    (l) => !l.startsWith('#') && !l.startsWith('📰') && !l.startsWith('🔗')
  );

  if (contentLines.length >= 2) {
    // Use the second line (first is the hook, second has context)
    return contentLines[1].slice(0, 130);
  }

  if (contentLines.length >= 1) {
    return contentLines[0].slice(0, 130);
  }

  return '';
}

/**
 * Render the final 1080×1080 flyer PNG.
 *
 * @param story        Scored story with caption draft
 * @param bgBuffer     1080×1080 AI-generated background image
 * @returns            Final 1080×1080 PNG buffer
 */
export async function renderFlyer(story: ScoredStory, bgBuffer: Buffer): Promise<Buffer> {
  mkdirSync(TMP_DIR, { recursive: true });

  const fonts = await loadFonts();
  const variant = chooseVariant(story);
  const categoryColor = CATEGORY_COLORS[story.category] ?? '#DC2626';
  const summary = extractFlierSummary(story.captionDraft);

  const templateOpts: FlyerTemplateOptions = {
    headline: story.headline,
    summary,
    category: story.category,
    categoryColor,
    bgImageBase64: '',  // Not used — bg is handled by Sharp
    variant,
  };

  const elementTree = getTemplate(templateOpts);

  // ── Step 1: Satori → SVG ───────────────────────────────────────────────────
  let svg: string;
  try {
    svg = await satori(elementTree as Parameters<typeof satori>[0], {
      width: W,
      height: H,
      fonts,
    });
  } catch (err) {
    throw new Error(`Satori render failed: ${(err as Error).message}`);
  }

  // ── Step 2: SVG → PNG (transparent background) ────────────────────────────
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    background: 'rgba(0,0,0,0)',  // Keep transparency
  });
  const renderedSvg = resvg.render();
  const overlayBuffer = Buffer.from(renderedSvg.asPng());

  // ── Step 3: Composite bg + frame.svg + Satori overlay via Sharp ────────────
  const framePath = join(process.cwd(), 'SVG', 'frame.svg');
  const composites = [];

  if (existsSync(framePath)) {
    const frameBuffer = await sharp(framePath)
      .resize(W, H, { fit: 'fill' })
      .toBuffer();
    composites.push({
      input: frameBuffer,
      top: 0,
      left: 0,
      blend: 'over' as const,
    });
  } else {
    console.warn(`[flyer] frame.svg not found at: ${framePath}. Rendering text only.`);
  }

  composites.push({
    input: overlayBuffer,
    top: 0,
    left: 0,
    blend: 'over' as const,
  });

  const finalBuffer = await sharp(bgBuffer)
    .resize(W, H, { fit: 'cover', position: 'centre' })
    .composite(composites)
    .png({ quality: 95 })
    .toBuffer();

  console.log(
    `[flyer] ✓ Rendered ${variant} template: ${(finalBuffer.length / 1024).toFixed(0)} KB`
  );

  return finalBuffer;
}
