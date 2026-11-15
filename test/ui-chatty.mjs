import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers';
import { screenshotViewport } from '../lib/screenshot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const VIEWPORT = process.env.CHATTY_VIEWPORT
  ? screenshotViewport(process.env.CHATTY_VIEWPORT)
  : screenshotViewport('desktop');

assert.ok(VIEWPORT.width >= 100 && VIEWPORT.height >= 100, 'screenshotViewport must return a valid viewport; got ' + JSON.stringify(VIEWPORT));

const ONLY = process.env.CHATTY_ONLY || '';
const RESPONSIVE_VIEWPORTS = [
  [390, 844],
  [844, 390],
  [320, 480],
];

// screenshot-based visual-regression harness for the Chatty browser test.
// Turn on with CHATTY_VISUAL=tour; it captures the same frames that are
// size-asserted in the main suite (tour intro, one tour advance, and a
// Cat-school frame) at the currently tested widths.
let VISUAL_MODE = process.env.CHATTY_VISUAL || '';
let VISUAL_EPISODES = process.env.CHATTY_VISUAL_EPISODES
  ? process.env.CHATTY_VISUAL_EPISODES.split(',')
  : ['lesson-start', 'tour-start', 'tour-next'];

export { screenshotViewport, VISUAL_MODE, VISUAL_EPISODES };

if (process.argv[1] && process.argv[1].endsWith('/test/ui-chatty.mjs')) {
  main().catch(err => { console.error(err); process.exitCode = 1; });
}
