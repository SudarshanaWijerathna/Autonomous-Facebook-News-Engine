/**
 * Flyer templates — Satori element tree factories.
 *
 * Renders ONLY the text block (headline + summary) on a transparent canvas.
 * The visual frame (logo, blue bars, and scrims) is composited from SVG/frame.svg.
 */

import type { FlyerTemplateOptions } from '../types.js';

type Style = Record<string, string | number | undefined>;

type SatoriNode = {
  type: string;
  props: {
    style?: Style;
    children?: SatoriNode | SatoriNode[] | string;
    [key: string]: unknown;
  };
};

const W = 1080;
const H = 1080;

/** Auto-shrink headline font size based on character count */
function headlineFontSize(headline: string): number {
  const len = headline.length;
  if (len <= 40) return 70;
  if (len <= 55) return 60;
  if (len <= 75) return 52;
  if (len <= 95) return 44;
  return 38;
}

/** Truncate text to approximate max lines at given font size */
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trimEnd() + '…';
}

function el(
  type: string,
  style: Style,
  children?: SatoriNode | SatoriNode[] | string,
  extra?: Record<string, unknown>
): SatoriNode {
  return { type, props: { style, children, ...extra } };
}

function textTemplate(opts: FlyerTemplateOptions): SatoriNode {
  const fs = headlineFontSize(opts.headline);
  const truncatedSummary = truncate(opts.summary, 120);

  return el('div', {
    width: `${W}px`,
    height: `${H}px`,
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  }, [
    el('div', {
      position: 'absolute',
      bottom: '120px',
      left: '100px',
      right: '100px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
    }, [
      el('div', {
        color: '#ffffff',
        fontSize: `${fs}px`,
        fontWeight: 800,
        fontFamily: 'Vastago Grotesk',
        lineHeight: 1.2,
        letterSpacing: '-0.02em',
        display: 'flex',
        justifyContent: 'center',
      }, truncate(opts.headline, 140)),
      el('div', {
        color: 'rgba(255,255,255,0.82)',
        fontSize: '28px',
        fontWeight: 400,
        fontFamily: 'Vastago Grotesk',
        lineHeight: 1.5,
        marginTop: '20px',
        display: 'flex',
        justifyContent: 'center',
      }, truncatedSummary)
    ])
  ]);
}

export function standardTemplate(opts: FlyerTemplateOptions): SatoriNode {
  return textTemplate(opts);
}

export function breakingTemplate(opts: FlyerTemplateOptions): SatoriNode {
  return textTemplate(opts);
}

export function sportsTemplate(opts: FlyerTemplateOptions): SatoriNode {
  return textTemplate(opts);
}

export function sensitiveTemplate(opts: FlyerTemplateOptions): SatoriNode {
  return textTemplate(opts);
}
