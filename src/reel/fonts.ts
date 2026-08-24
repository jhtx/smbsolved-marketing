/**
 * Bundled fonts, loaded before any frame renders. loadFont() blocks Remotion's
 * readiness until the face is available, so headless Chrome can never fall
 * back silently (the reason these are bundled at all — see README).
 *
 * Chosen 2026-08-23 (all SIL OFL, safe to embed in video):
 *   ReelSheet   Carlito         metric-compatible Calibri twin — the sheet
 *                               reads as Excel without licensing Aptos/Calibri
 *   ReelDisplay Archivo         heavy grotesque with a real 800 weight for
 *                               captions and overlays
 *   ReelMono    IBM Plex Mono   eyebrow and pills
 */
import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

const load = (family: string, file: string, weight: string) =>
  loadFont({ family, url: staticFile(`fonts/${file}`), weight });

export const fontsReady = Promise.all([
  load('ReelSheet', 'carlito-v4-latin-regular.ttf', '400'),
  load('ReelSheet', 'carlito-v4-latin-700.ttf', '700'),
  load('ReelDisplay', 'archivo-v25-latin-500.ttf', '500'),
  load('ReelDisplay', 'archivo-v25-latin-800.ttf', '800'),
  load('ReelMono', 'ibm-plex-mono-v20-latin-500.ttf', '500'),
]);
