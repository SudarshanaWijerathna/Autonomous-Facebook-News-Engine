/**
 * Font loader for Satori.
 *
 * Loads Vastago Grotesk fonts locally from the fonts/ directory.
 * Caches them in memory for the duration of the process.
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

interface FontEntry {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 700 | 800;
  style: 'normal';
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function getFontsDir(): string {
  // Try process.cwd()
  let dir = join(process.cwd(), 'fonts');
  if (existsSync(dir)) return dir;
  
  // Try relative to this file
  dir = join(__dirname, '..', '..', 'fonts');
  if (existsSync(dir)) return dir;
  
  // Try relative to dist output
  dir = join(__dirname, '..', '..', '..', 'fonts');
  if (existsSync(dir)) return dir;
  
  throw new Error(`Fonts directory not found. Please ensure 'fonts' folder is in the root directory.`);
}

let _fontCache: FontEntry[] | null = null;

export async function loadFonts(): Promise<FontEntry[]> {
  if (_fontCache) return _fontCache;

  console.log('[fonts] Loading Vastago Grotesk fonts locally...');
  const fontsDir = getFontsDir();

  const fontFiles: Array<{ weight: 400 | 700 | 800; filename: string }> = [
    { weight: 400, filename: 'VastagoGrotesk-Regular.otf' },
    { weight: 700, filename: 'VastagoGrotesk-Bold.otf' },
    { weight: 800, filename: 'VastagoGrotesk-Black.otf' },
  ];

  const fonts = fontFiles.map(({ weight, filename }) => {
    const filePath = join(fontsDir, filename);
    if (!existsSync(filePath)) {
      throw new Error(`Font file not found: ${filePath}`);
    }
    const data = readFileSync(filePath);
    // Convert Buffer to ArrayBuffer
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    return {
      name: 'Vastago Grotesk',
      data: arrayBuffer,
      weight,
      style: 'normal' as const,
    };
  });

  _fontCache = fonts;
  console.log('[fonts] ✓ Vastago Grotesk fonts loaded');
  return fonts;
}

