#!/usr/bin/env node
// Browser-level regression test for the CLOUD page's control-board tour.
//
//   CHROME_BIN=/path/to/chrome npm run test:cloud-tour
//
// The desktop suite (ui-chatty.mjs) only walks the desktop page. The cloud page
// has fewer controls - no starter row, no Quit button at phone width, Stop only
// while a turn runs - and that is exactly where the tour used to count stops it
// could not show: the labels jumped 8 -> 10 and 12 -> 14 and the tour ended on
// "17/18" with no finish, so it never looked done.
//
// This test serves the real cloud Worker locally (cloud/dev.mjs over Node's http
// server, with ./public as ASSETS), then drives the same page a visitor gets:
// every displayed stop must be numbered contiguously, its ring must sit on the
// control that stop is about, the last one must say "Finish tour", and finishing
// must record the tour so a reload does not start it again.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluate, findChrome, freePort, launchChrome, sleep, waitForHttp, waitForPage } from './browser.mjs';

const root = path.resolve(import.meta.dirname, '..');
const chromeBin = findChrome();

if (!chromeBin) {
  console.error('SKIP: set CHROME_BIN to a Chrome or Chromium executable to run this test.');
  process.exit(0);
}

// The control board in reading order. Both editions name the same ids; a page
// that lacks one simply has fewer stops, which is the point of this test.
const STOPS = [
  ['#sideBtn'],
  ['#newChatBtn', '#clearBtn'],
  ['#provider'],
  ['#modelBtn'],
  ['#quota', '#keyBtn'],
  ['#settingsBtn'],
  ['#quickPreview'],
  ['#railBtn'],
  ['#quitBtn'],
  ['#modePlan'],
  ['#modeBuild'],
  ['#input'],
  ['#suggest'],
  ['#imageLabel'],
  ['#attachLabel'],
  ['#memoryBtn'],
  ['#sendBtn', '#send'],
  ['#stopBtn', '#stop'],
];

// 390x844 is where the bug showed up; 844x390 has a different subset of the
// board (Quit is visible, the composer row is short), so both are walked.
const VIEWPORTS = [
  { width: 390, height: 844, label: '390x844' },
  { width: 844, height: 390, label: '844x390' },
];

const READY = 'document.readyState === "complete" && typeof window.FreewayChatty?.tour === "function"';

/** The cloud page opens its key card on a first visit; Chatty correctly stays
 *  away from an open dialog, so the test closes it the way a visitor would. */
const PREPARE = [
  '(() => {',
  '  for (const dialog of [...document.querySelectorAll("dialog[open]")]) {',
  '    try { dialog.close(); } catch (error) {}',
  '  }',
  '  for (const overlay of [...document.querySelectorAll(".overlay:not(.hidden)")]) overlay.classList.add("hidden");',
  '  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();',
  '  if (!window.FreewayChatty.isEnabled()) window.FreewayChatty.setEnabled(true);',
  '  window.FreewayChatty.show();',
  '  return true;',
  '})()',
].join('\n');

/** Everything one tour stop looks like right now, measured in the page. */
const SAMPLE = [
  '(() => {',
  '  const root = document.querySelector("#chatty");',
  '  const ring = [...document.querySelectorAll(".chatty-spot")].find((node) => !node.hidden) || null;',
  '  const bubble = document.querySelector(".chatty-bubble");',
  '  const primary = [...document.querySelectorAll("[data-chatty-action=\\"next\\"]")][0] || null;',
  '  const label = document.querySelector(".chatty-label")?.textContent?.trim() || "";',
  '  const match = label.match(/^Tour ([0-9]+)[/]([0-9]+)$/);',
  '  const rect = ring ? ring.getBoundingClientRect() : null;',
  '  return {',
  '    label: label,',
  '    number: match ? Number(match[1]) : 0,',
  '    total: match ? Number(match[2]) : 0,',
  '    text: (document.querySelector(".chatty-text")?.textContent || "").replace(/[ ]+/g, " ").trim(),',
  '    primary: primary ? primary.textContent.trim() : "",',
  '    bubble: Boolean(bubble && !bubble.hidden),',
  '    visible: Boolean(root && !root.hidden),',
  '    ring: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null,',
  '    ringInView: rect',
  '      ? rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1',
  '      : false,',
  '    flag: localStorage.getItem("freeway.chatty.tour.v2"),',
  '  };',
  '})()',
].join('\n');

const CLICK_NEXT = [
  '(() => {',
  '  const button = [...document.querySelectorAll("[data-chatty-action=\\"next\\"]")][0];',
  '  if (!button) return false;',
  '  button.click();',
  '  return true;',
  '})()',
].join('\n');

/** The control this stop should be pointing at: the next stop in STOPS order
 *  that this page actually renders. Independent of the runtime's own plan. */
const expectedTarget = (selectors) =>
  `(() => {
    const list = ${JSON.stringify(selectors)};
    for (const selector of list) {
      const node = document.querySelector(selector);
      if (!node) continue;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (rect.width < 2 || rect.height < 2) continue;
      return {
        selector: selector,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      };
    }
    return null;
  })()`;

function cloudWorkerBundle() {
  const bundle = path.join(root, 'cloud', 'dist', 'worker.mjs');
  if (fs.existsSync(bundle)) return bundle;
  // CI builds it first; a local run should not have to know that.
  console.log('  BUILD cloud/dist/worker.mjs (missing)');
  const built = spawnSync(process.execPath, ['build.mjs'], {
    cwd: path.join(root, 'cloud'),
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (built.status !== 0) {
    throw new Error(`cloud build failed:\n${built.stdout}\n${built.stderr}`);
  }
  return bundle;
}

async function startCloudHarness(port) {
  let log = '';
  const app = spawn(process.execPath, ['cloud/dev.mjs'], {
    cwd: root,
    // Node 22 gates node:sqlite behind this flag; without it the harness still
    // serves the page, it just has no budget database.
    env: { ...process.env, PORT: String(port), NODE_OPTIONS: '--experimental-sqlite' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.on('data', (chunk) => (log += chunk));
  app.stderr.on('data', (chunk) => (log += chunk));
  try {
    await waitForHttp(`http://127.0.0.1:${port}/api/config`, 20_000);
  } catch (error) {
    app.kill('SIGTERM');
    throw new Error(`${error.message}\nCloud harness log:\n${log.slice(-2000)}`);
  }
  return { app, log: () => log };
}

/** The ring is a 4px halo around the control, animated into place, so wait for
 *  it to stop moving before comparing rectangles. */
async function settledSample(cdp) {
  let previous = null;
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const now = await evaluate(cdp, SAMPLE);
    if (
      now.ring &&
      previous?.ring &&
      Math.abs(now.ring.left - previous.ring.left) < 1 &&
      Math.abs(now.ring.top - previous.ring.top) < 1 &&
      Math.abs(now.ring.right - previous.ring.right) < 1 &&
      Math.abs(now.ring.bottom - previous.ring.bottom) < 1
    ) {
      return now;
    }
    previous = now;
    await sleep(220);
  }
  return previous;
}

async function walkTour(cdp, origin, viewport) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
  await cdp.send('Page.navigate', { url: `${origin}/` });
  await waitForPage(cdp, READY, 20_000);
  await sleep(1200);
  await evaluate(cdp, PREPARE);
  if (!(await evaluate(cdp, `Boolean(document.querySelector('.chatty-label')?.textContent?.startsWith('Tour'))`))) {
    // The first-run sweep is scheduled a few seconds after boot; asking for it
    // directly keeps the test independent of that timer.
    await evaluate(cdp, 'window.FreewayChatty.tour(); true');
  }
  await waitForPage(cdp, `/^Tour [0-9]+[/][0-9]+$/.test(document.querySelector('.chatty-label')?.textContent || '')`, 10_000);

  let cursor = 0;
  let stops = 0;
  let finished = false;
  let last = null;

  for (let attempt = 0; attempt < 26; attempt += 1) {
    // The label is set while the tip is still measured and hidden, and the ring
    // arrives with the glide; wait for the landed frame before measuring it.
    await waitForPage(
      cdp,
      "document.querySelector('.chatty-bubble')?.hidden === false && " +
        "Boolean([...document.querySelectorAll('.chatty-spot')].find((node) => !node.hidden))",
      8000,
    );
    const now = await settledSample(cdp);
    if (/That's the tour/i.test(now.text)) {
      finished = true;
      last = now;
      break;
    }
    assert.ok(now.number > 0, `${viewport.label}: the tour lost its stop label ("${now.label}")`);
    assert.equal(now.visible, true, `${viewport.label}: stop ${now.number} left Chatty off screen`);
    assert.equal(now.bubble, true, `${viewport.label}: stop ${now.number} showed no tip`);
    assert.equal(
      now.number,
      stops + 1,
      `${viewport.label}: stop ${stops + 1} was skipped and the tour jumped to ${now.number}/${now.total}`,
    );
    assert.ok(
      now.total >= now.number,
      `${viewport.label}: stop ${now.number} claims a total of ${now.total}`,
    );
    assert.ok(now.ring, `${viewport.label}: stop ${now.number} drew no ring`);
    assert.equal(
      now.ringInView,
      true,
      `${viewport.label}: stop ${now.number} drew its ring off screen ${JSON.stringify(now.ring)}`,
    );

    // Which control is this stop about? The next one this page actually renders.
    let expected = null;
    let expectedIndex = -1;
    for (let index = cursor; index < STOPS.length && !expected; index += 1) {
      expected = await evaluate(cdp, expectedTarget(STOPS[index]));
      if (expected) expectedIndex = index;
    }
    assert.ok(
      expected,
      `${viewport.label}: stop ${now.number} showed more stops than this page has controls`,
    );
    cursor = expectedIndex + 1;

    const tolerance = 6;
    const near = (a, b) => Math.abs(a - b) <= tolerance;
    const ringCoversControl =
      now.ring.left <= expected.rect.left + tolerance &&
      now.ring.top <= expected.rect.top + tolerance &&
      now.ring.right >= expected.rect.right - tolerance &&
      now.ring.bottom >= expected.rect.bottom - tolerance;
    assert.equal(
      ringCoversControl,
      true,
      `${viewport.label}: stop ${now.number} ring ${JSON.stringify(now.ring)} misses its control ` +
        `${expected.selector} ${JSON.stringify(expected.rect)}`,
    );
    const ringCenter = {
      x: (now.ring.left + now.ring.right) / 2,
      y: (now.ring.top + now.ring.bottom) / 2,
    };
    assert.equal(
      ringCenter.x >= expected.rect.left - tolerance &&
        ringCenter.x <= expected.rect.right + tolerance &&
        ringCenter.y >= expected.rect.top - tolerance &&
        ringCenter.y <= expected.rect.bottom + tolerance,
      true,
      `${viewport.label}: stop ${now.number} points beside its control ${expected.selector}`,
    );

    // Is this the last stop this page can show? Then it must offer Finish.
    let remaining = null;
    for (let index = cursor; index < STOPS.length && !remaining; index += 1) {
      remaining = await evaluate(cdp, expectedTarget(STOPS[index]));
    }
    const wantsFinish = !remaining;
    if (wantsFinish) {
      // Ending on "15/18" is the bug this test exists for: the tour looked
      // unfinished because the total counted controls this page cannot show.
      assert.equal(
        now.number,
        now.total,
        `${viewport.label}: the tour ends on stop ${now.number}/${now.total}, not on its last stop`,
      );
    }
    assert.equal(
      now.primary,
      wantsFinish ? 'Finish tour' : 'Next stop',
      `${viewport.label}: stop ${now.number} offers "${now.primary}" instead of ` +
        (wantsFinish ? '"Finish tour"' : '"Next stop"'),
    );

    stops += 1;
    assert.equal(await evaluate(cdp, CLICK_NEXT), true, `${viewport.label}: stop ${now.number} has no primary action`);
  }

  assert.equal(finished, true, `${viewport.label}: the tour never reached its completion bubble`);
  assert.ok(stops > 8, `${viewport.label}: the tour only showed ${stops} stops`);
  assert.match(last.text, /That's the tour/i, `${viewport.label}: the tour did not finish`);
  assert.equal(last.flag, '1', `${viewport.label}: finishing the tour did not record it`);
  // The completion tip names Settings, so Chatty may point at it; only the tour
  // numbering has to be gone.
  assert.doesNotMatch(last.label, /^Tour /, `${viewport.label}: the finished tour kept a tour label`);

  // A finished tour stays finished: the same visitor reloading is not a first run.
  await cdp.send('Page.reload');
  await sleep(9000);
  const after = await evaluate(
    cdp,
    `(() => ({
      label: document.querySelector('.chatty-label')?.textContent?.trim() || '',
      text: document.querySelector('.chatty-text')?.textContent || '',
      flag: localStorage.getItem('freeway.chatty.tour.v2'),
    }))()`,
  );
  assert.equal(after.flag, '1', `${viewport.label}: the finished tour flag did not survive a reload`);
  assert.doesNotMatch(after.label, /^Tour /, `${viewport.label}: a finished tour restarted as "${after.label}"`);
  assert.doesNotMatch(after.text, /Control board tour/, `${viewport.label}: the finished tour opened again`);

  return { stops, total: stops };
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'freeway-cloud-tour-'));
  let app;
  let chrome;
  let cdp;
  let appLog = () => '';
  let chromeLog = () => '';
  try {
    cloudWorkerBundle();
    const port = await freePort();
    const started = await startCloudHarness(port);
    app = started.app;
    appLog = started.log;
    const origin = `http://127.0.0.1:${port}`;
    console.log(`  CLOUD  ${origin}`);

    const browser = await launchChrome({
      chromePath: chromeBin,
      userDataDir: path.join(temp, 'chrome'),
      viewport: { width: VIEWPORTS[0].width, height: VIEWPORTS[0].height, deviceScaleFactor: 1, mobile: true },
    });
    chrome = browser.chrome;
    cdp = browser.cdp;
    chromeLog = browser.log;

    for (const viewport of VIEWPORTS) {
      const run = await walkTour(cdp, origin, viewport);
      console.log(
        `  PASS  cloud ${viewport.label}: tour ${run.stops}/${run.total}, ring on every stop's control, Finish, stays done`,
      );
    }

    console.log('PASS browser cloud tour: the cloud page walks its own stops to Finish at phone and landscape sizes.');
  } catch (error) {
    console.error('FAIL browser cloud tour:', error.stack || error.message);
    console.error('Cloud harness log:', appLog().slice(-3000));
    console.error('Chrome log:', chromeLog().slice(-3000));
    process.exitCode = 1;
  } finally {
    cdp?.close();
    chrome?.kill('SIGTERM');
    app?.kill('SIGTERM');
    await sleep(200);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

await main();
