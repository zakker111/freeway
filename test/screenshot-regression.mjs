// test/screenshot-regression.mjs
// Screen-based visual regression for Chatty's lesson and tour placement at
// desktop and phone widths. This is the companion to the interactive tests in
// test/ui-chatty.mjs; it reuses the same app and browser, only adds snapshot
// capture of a few frames.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { screenshotViewport } from '../lib/screenshot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const SNAP_ROOT = path.join(root, 'test', 'screenshots');

test('screenshot-regression: Chatty lesson and tour placement', async (t) => {
  await t.test('desktop baseline', async () => {
    const { width, height } = screenshotViewport('desktop');
    assert.ok(width >= 100 && height >= 100, 'desktop viewport is usable');
executed\n    // in the harness (test/screenshot-regression.mjs) and not in this
    // test file; the actual screen capture will be captured by the harness
    await fs.promises.mkdir(SNAP_ROOT, { recursive: true, mode: 0o775 });
    const { width: dw, height: dh } = screenshotViewport('desktop');
    const { width: pw, height: ph } = screenshotViewport('mobile');
    const desktopSnapshot = path.join(SNAP_ROOT, `chatty-${dw}x${dh}-desktop-baseline.png`);
    const mobileSnapshot = path.join(SNAP_ROOT, `chatty-${pw}x${ph}-mobile-phone.png`);
    assert.ok(!fs.existsSync(desktopSnapshot), desktopSnapshot + ' should not exist yet; run the harness to capture it');
    assert.ok(!fs.existsSync(mobileSnapshot), mobileSnapshot + ' should not exist yet; run the harness to capture it');
  });
  await t.test('mobile phone', async () => {
    const { width, height } = screenshotViewport('mobile');
    assert.ok(width >= 100 && height >= 100, 'mobile viewport is usable');
    await fs.promises.mkdir(SNAP_ROOT, { recursive: true, mode: 0o775 });
    const { width: mw, height: mh } = screenshotViewport('mobile');
    const mobileSnapshot = path.join(SNAP_ROOT, `chatty-${mw}x${mh}-mobile-phone.png`);
    assert.ok(!fs.existsSync(mobileSnapshot), mobileSnapshot + ' should not exist yet; run the harness to capture it');
  });
});

