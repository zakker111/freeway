#!/usr/bin/env node
// Browser-level regression test for Chatty's companion paths.
//
//   CHROME_BIN=/path/to/chrome npm run test:chatty
//
// Like the other UI checks, this uses the Chrome DevTools Protocol rather than
// a browser-automation dependency. It starts the real desktop app on a free
// loopback port, clears Chatty's local state, and drives the same controls a
// user does: the welcome actions, Cat school, the tour, Settings and the
// reduced-motion media query.
//
// Travel is sampled while the glide is still running. Comparing only the final
// positions would still pass if the animation stopped running.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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

const MOVE_SETTLE_MS = 1450;
const VIEWPORT = (() => {
  const [width, height] = String(process.env.CHATTY_VIEWPORT || '1366x768')
    .split('x')
    .map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 240 || height < 240) {
    throw new Error('CHATTY_VIEWPORT must be WIDTHxHEIGHT, for example 390x844');
  }
  return { width: Math.round(width), height: Math.round(height) };
})();
const ONLY = process.env.CHATTY_ONLY || '';
// The control board, in reading order. The tour and the tests that walk it to
// the end share this list so a new stop cannot be added to one and not the other.
const TOUR_TARGETS = [
  [
    "#sideBtn"
  ],
  [
    "#newChatBtn",
    "#clearBtn"
  ],
  [
    "#provider"
  ],
  [
    "#modelBtn"
  ],
  [
    "#quota",
    "#keyBtn"
  ],
  [
    "#settingsBtn"
  ],
  [
    "#quickPreview"
  ],
  [
    "#railBtn"
  ],
  [
    "#quitBtn"
  ],
  [
    "#modePlan"
  ],
  [
    "#modeBuild"
  ],
  [
    "#input"
  ],
  [
    "#suggest"
  ],
  [
    "#imageLabel"
  ],
  [
    "#attachLabel"
  ],
  [
    "#memoryBtn"
  ],
  [
    "#sendBtn",
    "#send"
  ],
  [
    "#stopBtn",
    "#stop"
  ]
];

const RESPONSIVE_VIEWPORTS = [
  [390, 844],
  [844, 390],
  [320, 480],
];

async function startApp(temp) {
  const workspace = path.join(temp, 'workspace');
  fs.mkdirSync(workspace);
  const config = path.join(temp, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ workspace }, null, 2));
  const port = await freePort();
  let log = '';
  const app = spawn(
    process.execPath,
    ['app.mjs', '--host', '127.0.0.1', '--port', String(port), '--config', config],
    {
      cwd: root,
      env: { ...process.env, NO_OPEN: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  app.stdout.on('data', (chunk) => (log += chunk));
  app.stderr.on('data', (chunk) => (log += chunk));
  try {
    await waitForHttp(`http://127.0.0.1:${port}/api/config`);
  } catch (error) {
    app.kill('SIGTERM');
    throw new Error(`${error.message}\nApp log:\n${log.slice(-2000)}`);
  }
  return { app, port, log: () => log };
}

async function state(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const root = document.querySelector('#chatty');
      const pet = root ? root.querySelector('.chatty-pet') : null;
      const bubble = document.querySelector('.chatty-bubble');
      const rect = root ? root.getBoundingClientRect() : null;
      const spot = [...document.querySelectorAll('.chatty-spot')]
        .find((node) => !node.hidden) || null;
      return {
        hidden: !root || root.hidden,
        visible: Boolean(root && !root.hidden && root.classList.contains('is-in')),
        pos: root ? root.dataset.pos || '' : '',
        label: document.querySelector('.chatty-label')?.textContent?.trim() || '',
        text: document.querySelector('.chatty-text')?.textContent?.trim() || '',
        bubble: Boolean(bubble && !bubble.hidden),
        actions: [...document.querySelectorAll('[data-chatty-action]')].map(
          (node) => node.dataset.chattyAction,
        ),
        touring: Boolean(root && root.classList.contains('is-touring')),
        anim: pet ? getComputedStyle(pet).animationName : '',
        xy: rect ? [Math.round(rect.x), Math.round(rect.y)] : [],
        spot: Boolean(spot),
        storage: localStorage.getItem('freeway.chatty.enabled'),
      };
    })()`,
  );
}

async function clickAction(cdp, action) {
  return evaluate(
    cdp,
    `(() => {
      const button = [...document.querySelectorAll('[data-chatty-action]')]
        .find((node) => node.dataset.chattyAction === ${JSON.stringify(action)});
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );
}

async function clickAndSample(cdp, action, delay = 90) {
  return evaluate(
    cdp,
    `(async () => {
      const button = [...document.querySelectorAll('[data-chatty-action]')]
        .find((node) => node.dataset.chattyAction === ${JSON.stringify(action)});
      if (!button) return { found: false };
      button.click();
      await new Promise((resolve) => setTimeout(resolve, ${delay}));
      const root = document.querySelector('#chatty');
      const pet = root ? root.querySelector('.chatty-pet') : null;
      const rect = root ? root.getBoundingClientRect() : null;
      const bubble = document.querySelector('.chatty-bubble');
      return {
        found: true,
        touring: Boolean(root && root.classList.contains('is-touring')),
        anim: pet ? getComputedStyle(pet).animationName : '',
        label: document.querySelector('.chatty-label')?.textContent?.trim() || '',
        bubble: Boolean(bubble && !bubble.hidden),
        xy: rect ? [Math.round(rect.x), Math.round(rect.y)] : [],
      };
    })()`,
  );
}

async function clickAndTrack(cdp, action, delays = [80, 300, 750, 1450]) {
  return evaluate(
    cdp,
    `(async () => {
      const button = [...document.querySelectorAll('[data-chatty-action]')]
        .find((node) => node.dataset.chattyAction === ${JSON.stringify(action)});
      if (!button) return { found: false, frames: [] };
      const cssMs = (value) => {
        const number = Number.parseFloat(value) || 0;
        return /ms$/.test(value) ? number : number * 1000;
      };
      const read = () => {
        const root = document.querySelector('#chatty');
        const pet = root ? root.querySelector('.chatty-pet') : null;
        const bubble = document.querySelector('.chatty-bubble');
        const spot = [...document.querySelectorAll('.chatty-spot')]
          .find((node) => !node.hidden) || null;
        const spotStyle = spot ? getComputedStyle(spot) : null;
        const spotProps = spotStyle ? spotStyle.transitionProperty.split(',').map((value) => value.trim()) : [];
        const spotDurations = spotStyle ? spotStyle.transitionDuration.split(',').map(cssMs) : [];
        const spotMoveMs = spotProps.indexOf('left') >= 0 ? spotDurations[spotProps.indexOf('left')] : 0;
        const rect = root ? root.getBoundingClientRect() : null;
        return {
          touring: Boolean(root && root.classList.contains('is-touring')),
          anim: pet ? getComputedStyle(pet).animationName : '',
          label: document.querySelector('.chatty-label')?.textContent?.trim() || '',
          bubble: Boolean(bubble && !bubble.hidden),
          xy: rect ? [Math.round(rect.x), Math.round(rect.y)] : [],
          spot: Boolean(spot),
          spotMs: Math.round(spotMoveMs || 0),
          moveMs: root ? Math.round(cssMs(getComputedStyle(root).getPropertyValue('--chatty-move-ms'))) : 0,
          animations: root
            ? root.getAnimations().map((animation) => ({
                state: animation.playState,
                current: Math.round(Number(animation.currentTime) || 0),
                duration: Math.round(Number(animation.effect?.getTiming?.().duration) || 0),
              }))
            : [],
        };
      };
      const started = read();
      const start = Date.now();
      const frames = [];
      button.click();
      for (const delay of ${JSON.stringify(delays)}) {
        const wait = delay - (Date.now() - start);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        frames.push(read());
      }
      return { found: true, started, frames };
    })()`,
  );
}

function assertMoving(result, label, allowPrep = false) {
  const { started, frames } = result;
  assert.ok(frames.length >= 3, `${label} did not produce enough movement frames`);
  // A tour target below the fold scrolls into view first. That is a prep
  // phase, not the cat's travel, so find the first actual walking frame
  // instead of assuming it is the first sample.
  const movingIndex = frames.findIndex((frame) => frame.touring && frame.anim === 'chatty-walk');
  assert.ok(movingIndex >= 0, `${label} never entered the movement state`);
  if (!allowPrep) assert.equal(movingIndex, 0, `${label} did not start moving on the first sample`);
  assert.equal(frames[movingIndex].bubble, false, `${label} kept the old bubble while travelling`);
  const positions = new Set([started.xy.join(':'), ...frames.map((frame) => frame.xy.join(':'))]);
  assert.ok(
    positions.size >= 2,
    `${label} never changed her screen position (${[...positions].join(' | ')})`,
  );
  const animated = frames.some((frame) =>
    frame.animations.some(
      (animation) =>
        animation.state === 'running' && animation.duration > 0 && animation.current > 0,
    ),
  );
  assert.ok(animated, `${label} finished without a running travel animation`);
  const ringFrame = frames.find((frame) => frame.spot && frame.spotMs > 0 && frame.moveMs > 0);
  if (ringFrame) {
    assert.ok(
      Math.abs(ringFrame.spotMs - ringFrame.moveMs) <= 2,
      `${label} moved the target ring in ${ringFrame.spotMs}ms but the cat in ${ringFrame.moveMs}ms`,
    );
  }
  const last = frames[frames.length - 1];
  assert.equal(last.touring, false, `${label} did not finish the movement`);
  assert.equal(last.bubble, true, `${label} did not show the new bubble after landing`);
  assert.notDeepEqual(last.xy, started.xy, `${label} ended where it started`);
}

async function tourPlacement(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const root = document.querySelector('#chatty');
      const spot = [...document.querySelectorAll('.chatty-spot')].find((node) => !node.hidden);
      const bubble = document.querySelector('.chatty-bubble');
      if (!root || !spot) return null;
      const rr = root.getBoundingClientRect();
      const sr = spot.getBoundingClientRect();
      const br = bubble && !bubble.hidden ? bubble.getBoundingClientRect() : null;
      const overlaps = (a, b) => !(
        a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom
      );
      const round = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
      const header = document.querySelector('header');
      return {
        catInside: rr.left >= 0 && rr.top >= 0 && rr.right <= innerWidth && rr.bottom <= innerHeight,
        bubbleInside: br
          ? br.left >= 0 && br.top >= 0 && br.right <= innerWidth && br.bottom <= innerHeight
          : null,
        catOverlapsTarget: overlaps(rr, sr),
        bubbleOverlapsTarget: br ? overlaps(br, sr) : null,
        viewport: { w: innerWidth, h: innerHeight },
        headerBottom: header ? Math.round(header.getBoundingClientRect().bottom) : 0,
        bubbleSide: root.dataset.bubble || '',
        catBubbleSide: root.dataset.bubbleSide || '',
        cat: round(rr),
        bubble: br ? round(br) : null,
        target: round(sr),
      };
    })()`,
  );
}

async function tourTarget(cdp, selectors) {
  return evaluate(
    cdp,
    `(() => {
      const spot = document.querySelector('.chatty-spot');
      if (!spot) return null;
      const spotRect = spot.getBoundingClientRect();
      const cx = spotRect.left + spotRect.width / 2;
      const cy = spotRect.top + spotRect.height / 2;
      return ${JSON.stringify(selectors)}.find((selector) => {
        const node = document.querySelector(selector);
        if (!node) return false;
        const rect = node.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return false;
        return (
          Math.abs(rect.left + rect.width / 2 - cx) <= 2 &&
          Math.abs(rect.top + rect.height / 2 - cy) <= 2
        );
      }) || null;
    })()`,
  );
}

async function prepareChatty(cdp) {
  const hadKeyCard = await evaluate(
    cdp,
    `(() => {
      const overlay = document.querySelector('#keyOverlay');
      return Boolean(overlay && !overlay.classList.contains('hidden'));
    })()`,
  );
  assert.equal(hadKeyCard, true, 'the first-run key card did not open');
  await evaluate(
    cdp,
    `(() => {
      document.querySelector('#keyCancel')?.click();
      document.querySelectorAll('dialog[open]').forEach((dialog) => {
        try { dialog.close(); } catch {}
      });
      document.querySelectorAll('.overlay:not(.hidden)').forEach((overlay) => {
        overlay.classList.add('hidden');
      });
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      if (!window.FreewayChatty.isEnabled()) window.FreewayChatty.setEnabled(true);
      return true;
    })()`,
  );
  // A clean first run must open the control-board tour without waiting for a
  // click on a welcome card. Showing it directly makes the test deterministic.
  await evaluate(cdp, `window.FreewayChatty.show(); true`);
  await waitForPage(
    cdp,
    `(() => {
      const root = document.querySelector('#chatty');
      return Boolean(
        root &&
        !root.hidden &&
        root.classList.contains('is-in') &&
        /^Tour 1\\//.test(document.querySelector('.chatty-label')?.textContent || '') &&
        document.querySelector('.chatty-bubble')?.hidden === false
      );
    })()`,
    10_000,
  );
}

async function loadChatty(cdp, origin, reduced) {
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' },
    ],
  });
  await cdp.send('Storage.clearDataForOrigin', {
    origin,
    storageTypes: 'all',
  });
  await cdp.send('Page.navigate', { url: `${origin}/` });
  await waitForPage(
    cdp,
    'document.readyState === "complete" && typeof window.FreewayChatty?.tutor === "function"',
    15_000,
  );
  // Let Chatty's first appearance attempt see the key card and back off. The
  // dismissal must bring her back immediately, not wait for the 22-second retry.
  await sleep(2600);
  await prepareChatty(cdp);
}

async function openSettings(cdp) {
  const clicked = await evaluate(
    cdp,
    `(() => {
      const button = document.querySelector('#settingsBtn');
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );
  assert.equal(clicked, true, 'the desktop Settings control is missing');
  await waitForPage(
    cdp,
    `!document.querySelector('#settingsOverlay').classList.contains('hidden')`,
  );
}

async function saveSettings(cdp) {
  await evaluate(cdp, `document.querySelector('#settingsSave').click(); true`);
  await waitForPage(
    cdp,
    `document.querySelector('#settingsOverlay').classList.contains('hidden')`,
  );
}

async function runTutor(cdp, origin) {
  await loadChatty(cdp, origin, false);

  const firstTour = await state(cdp);
  assert.match(firstTour.label, /^Tour 1\//, `a clean load did not start the tour (${firstTour.label})`);
  assert.equal(firstTour.bubble, true, 'the auto-start tour has no bubble');
  assert.match(firstTour.text, /Control board tour/i, 'the auto-start tour has no intro');

  // End the first-run sweep and start Cat school from a visible, idle Chatty.
  assert.equal(await clickAction(cdp, 'skip'), true, 'the auto-start tour has no End tour action');
  await waitForPage(cdp, `document.querySelector('#chatty')?.hidden === true`, 5000);
  await evaluate(cdp, `window.FreewayChatty.show(); true`);
  await waitForPage(
    cdp,
    `(() => {
      const root = document.querySelector('#chatty');
      return Boolean(root && !root.hidden && root.classList.contains('is-in'));
    })()`,
    5000,
  );
  const beforeTutor = await state(cdp);
  assert.equal(beforeTutor.xy.length, 2, 'Chatty has no screen position before tutoring');

  await evaluate(cdp, `window.FreewayChatty.tutor(); true`);
  await waitForPage(
    cdp,
    `document.querySelector('.chatty-label')?.textContent === 'Cat school 1/3'`,
    5000,
  );
  await sleep(MOVE_SETTLE_MS);
  const s1 = await state(cdp);
  assert.equal(s1.label, 'Cat school 1/3', `the lesson did not start (${s1.label})`);
  assert.equal(s1.bubble, true, 'the first lesson step has no bubble');
  // The first step only hops when it brings her back from hiding
  // (showTutorStep({ move: !wasHidden })), so her corner here depends on
  // whether the previous tip had already hidden her. Movement is asserted on
  // every Next paw below, where the corner is guaranteed to change.
  assert.notEqual(s1.text, beforeTutor.text, 'the first lesson step kept the previous text');

  const second = await clickAndTrack(cdp, 'tutor-next');
  assert.equal(second.found, true, 'the first lesson step has no Next paw action');
  assertMoving(second, 'Next paw');
  const s2 = await state(cdp);
  assert.equal(s2.label, 'Cat school 2/3', `the second step label is ${s2.label}`);
  assert.notEqual(s2.pos, s1.pos, 'Next paw did not move Chatty');
  assert.notDeepEqual(s2.xy, s1.xy, 'Next paw did not change her screen position');
  assert.equal(s2.bubble, true, 'the second lesson step lost its bubble');

  const third = await clickAndTrack(cdp, 'tutor-next');
  assert.equal(third.found, true, 'the second lesson step has no Next paw action');
  assertMoving(third, 'the third step');
  const s3 = await state(cdp);
  assert.equal(s3.label, 'Cat school 3/3', `the third step label is ${s3.label}`);
  assert.notEqual(s3.pos, s2.pos, 'the third step did not move Chatty');
  assert.notDeepEqual(s3.xy, s2.xy, 'the third step did not change her screen position');
  assert.equal(s3.bubble, true, 'the third lesson step lost its bubble');

  assert.equal(await clickAction(cdp, 'tutor-next'), true, 'the last step has no Finish lesson action');
  await sleep(250);
  const done = await state(cdp);
  assert.equal(done.label, 'Cat school · done', `finishing the lesson shows ${done.label}`);
  assert.ok(done.actions.includes('tutor-another'), 'the finished lesson has no Another lesson action');
  assert.notEqual(done.text, s3.text, 'the finished lesson kept the last step text');

  const another = await clickAndTrack(cdp, 'tutor-another');
  assert.equal(another.found, true, 'the finished lesson has no Another lesson action');
  assertMoving(another, 'Another lesson');
  const restarted = await state(cdp);
  assert.equal(restarted.label, 'Cat school 1/3', `Another lesson did not start (${restarted.label})`);
  assert.notEqual(restarted.text, s1.text, 'Another lesson repeated the same lesson');

  assert.equal(await clickAction(cdp, 'tutor-stop'), true, 'the lesson has no Stop action');
  await sleep(200);
  const stopped = await state(cdp);
  assert.equal(stopped.label, 'Chatty', `Stop left the label at ${stopped.label}`);
  assert.match(stopped.text, /^Class dismissed/, 'Stop did not dismiss the lesson');
  assert.ok(stopped.actions.includes('tutor'), 'Stop did not restore the Tutor me action');
  assert.equal(stopped.touring, false, 'Stop left the movement state on');
}

async function runTour(cdp, origin) {
  await loadChatty(cdp, origin, false);
  const targets = TOUR_TARGETS;
  const expected = [
    /saved conversations/i,
    /clean chat/i,
    /who answers/i,
    /free model list/i,
    /free usage/i,
    /Settings/i,
    /working preview/i,
    /Files opens/i,
    /Quit stops/i,
    /read-only/i,
    /Allow card/i,
    /composer/i,
    /starters/i,
    /Image attaches/i,
    /text file/i,
    /note I carry/i,
    /Send posts/i,
    /Stop cancels/i,
  ];
  // A clean load auto-starts this sweep; there is no welcome card to click.
  await waitForPage(
    cdp,
    `document.querySelector('.chatty-label')?.textContent?.startsWith('Tour 1/')`,
    8000,
  );

  const matched = [];
  for (let index = 0; index < targets.length; index += 1) {
    const number = index + 1;
    await waitForPage(
      cdp,
      `document.querySelector('.chatty-label')?.textContent?.startsWith('Tour ${number}/') &&
       document.querySelector('.chatty-bubble')?.hidden === false`,
      5000,
    );
    // Sample the landed frame before fitBubble's delayed correction (if any),
    // then require the position to stay put. Sleeping first would hide exactly
    // the late hop this test is meant to catch.
    await sleep(30);
    const stop = await state(cdp);
    assert.match(stop.label, new RegExp(`^Tour ${number}\\/\\d+$`), `tour stop ${number} is ${stop.label}`);
    assert.equal(stop.bubble, true, `tour stop ${number} has no bubble`);
    assert.equal(stop.spot, true, `tour stop ${number} has no spotlight`);
    assert.match(
      stop.text,
      expected[index],
      `tour stop ${number} does not explain its control (${stop.text})`,
    );
    const target = await tourTarget(cdp, targets[index]);
    assert.ok(target, `tour stop ${number} highlights no target (${targets[index].join(', ')})`);
    const placement = await tourPlacement(cdp);
    assert.ok(placement, `tour stop ${number} has no placement geometry`);
    assert.equal(placement.catInside, true, `tour stop ${number} put Chatty off screen ${JSON.stringify(placement)}`);
    assert.equal(placement.bubbleInside, true, `tour stop ${number} put her bubble off screen ${JSON.stringify(placement)}`);
    assert.equal(
      placement.catOverlapsTarget,
      false,
      `tour stop ${number} parked Chatty over the control she is explaining ${JSON.stringify(placement)}`,
    );
    assert.equal(
      placement.bubbleOverlapsTarget,
      false,
      `tour stop ${number} covered the control with her bubble ${JSON.stringify(placement)}`,
    );
    matched.push(target);
    await sleep(340);
    const settled = await state(cdp);
    assert.deepEqual(
      settled.xy,
      stop.xy,
      `tour stop ${number} corrected its position after the bubble appeared`,
    );
    await sleep(MOVE_SETTLE_MS - 370);

    if (number < targets.length) {
      const nextOffscreen = await evaluate(
        cdp,
        `(() => ${JSON.stringify(targets[index + 1])}.some((selector) => {
          const node = document.querySelector(selector);
          if (!node) return false;
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return (
            rect.width > 0 && rect.height > 0 &&
            style.display !== 'none' && style.visibility !== 'hidden' &&
            (rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth)
          );
        }))()`,
      );
      const delays = nextOffscreen ? [80, 300, 750, 1600, 2400] : [80, 300, 750, 1450];
      const next = await clickAndTrack(cdp, 'next', delays);
      assert.equal(next.found, true, `tour stop ${number} has no Next action`);
      assertMoving(next, `tour stop ${number} movement`, nextOffscreen);
    }
  }

  assert.equal(matched.length, targets.length, 'the tour did not reach every stop');
  assert.equal(await clickAction(cdp, 'skip'), true, 'the tour has no End tour action');
  await waitForPage(
    cdp,
    `document.querySelector('#chatty')?.hidden === true`,
    5000,
  );
}

/**
 * Walk the tour with the primary action until it ends on its own.
 *
 * The earlier tour test describes the last stop and then presses End tour, so
 * the Finish path - what a user takes when they follow the tour to the end -
 * was never exercised. Every stop is also checked for the thing its tip is
 * talking about: the ring has to be on screen and sit around one of that
 * stop's own controls.
 */
async function runTourFinish(cdp, origin) {
  await loadChatty(cdp, origin, false);

  const pageStep = "(() => {\n  const spot = [...document.querySelectorAll('.chatty-spot')].find((node) => !node.hidden) || null;\n  const bubble = document.querySelector('.chatty-bubble');\n  const primary = [...document.querySelectorAll('[data-chatty-action=\"next\"]')][0] || null;\n  const label = document.querySelector('.chatty-label')?.textContent?.trim() || '';\n  const number = Number((label.match(/^Tour ([0-9]+)\\//) || [])[1] || 0);\n  const selectors = [[\"#sideBtn\"],[\"#newChatBtn\",\"#clearBtn\"],[\"#provider\"],[\"#modelBtn\"],[\"#quota\",\"#keyBtn\"],[\"#settingsBtn\"],[\"#quickPreview\"],[\"#railBtn\"],[\"#quitBtn\"],[\"#modePlan\"],[\"#modeBuild\"],[\"#input\"],[\"#suggest\"],[\"#imageLabel\"],[\"#attachLabel\"],[\"#memoryBtn\"],[\"#sendBtn\",\"#send\"],[\"#stopBtn\",\"#stop\"]][number - 1] || [];\n  let target = null;\n  for (const selector of selectors) {\n    const node = document.querySelector(selector);\n    if (!node) continue;\n    const rect = node.getBoundingClientRect();\n    const style = getComputedStyle(node);\n    if (rect.width < 2 || rect.height < 2 || style.display === 'none' || style.visibility === 'hidden') continue;\n    target = { selector, rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } };\n    break;\n  }\n  const sr = spot ? spot.getBoundingClientRect() : null;\n  return {\n    label, number,\n    text: document.querySelector('.chatty-text')?.textContent || '',\n    primary: primary ? primary.textContent.trim() : '',\n    bubble: Boolean(bubble && !bubble.hidden),\n    ring: sr ? { left: sr.left, top: sr.top, right: sr.right, bottom: sr.bottom } : null,\n    ringInView: sr ? sr.left >= -1 && sr.top >= -1 && sr.right <= innerWidth + 1 && sr.bottom <= innerHeight + 1 : false,\n    target,\n    flag: localStorage.getItem('freeway.chatty.tour.v2'),\n  };\n})()";
  const step = () => evaluate(cdp, pageStep);
  const clickNext = () =>
    evaluate(
      cdp,
      "(() => { const button = [...document.querySelectorAll('[data-chatty-action=\"next\"]')][0]; if (!button) return false; button.click(); return true; })()",
    );

  const seen = [];
  let last = null;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await waitForPage(
      cdp,
      "document.querySelector('.chatty-bubble')?.hidden === false",
      6000,
    );
    await sleep(700);
    const now = await step();
    if (/That's the tour/i.test(now.text)) {
      last = now;
      break;
    }
    assert.ok(now.number > 0, `the tour lost its stop number (label "${now.label}")`);
    assert.equal(now.bubble, true, `tour stop ${now.number} has no bubble`);
    assert.ok(now.ring, `tour stop ${now.number} shows no ring`);
    assert.equal(now.ringInView, true, `tour stop ${now.number} drew its ring off screen ${JSON.stringify(now.ring)}`);
    assert.ok(now.target, `tour stop ${now.number} (${now.label}) names no control that is on the page`);
    const cx = (now.ring.left + now.ring.right) / 2;
    const cy = (now.ring.top + now.ring.bottom) / 2;
    const inside =
      cx >= now.target.rect.left - 6 &&
      cx <= now.target.rect.right + 6 &&
      cy >= now.target.rect.top - 6 &&
      cy <= now.target.rect.bottom + 6;
    assert.equal(
      inside,
      true,
      `tour stop ${now.number} points at nothing: ring ${JSON.stringify(now.ring)} vs ${now.target.selector} ${JSON.stringify(now.target.rect)}`,
    );
    const lastStop = now.number === TOUR_TARGETS.length;
    assert.equal(
      now.primary,
      lastStop ? 'Finish tour' : 'Next stop',
      `tour stop ${now.number} offers "${now.primary}" instead of ${lastStop ? 'Finish tour' : 'Next stop'}`,
    );
    seen.push(now.number);
    assert.equal(await clickNext(), true, `tour stop ${now.number} has no primary action`);
  }

  assert.deepEqual(seen, TOUR_TARGETS.map((_, index) => index + 1), 'the tour did not walk every stop in order');
  assert.ok(last, 'the tour never reached its completion bubble');
  assert.match(last.text, /That's the tour/i, 'the tour did not finish');
  assert.equal(last.flag, '1', 'finishing the tour did not record it');

  // A finished tour stays finished: a reload is a returning visit, not another
  // first run.
  await cdp.send('Page.navigate', { url: `${origin}/` });
  await waitForPage(cdp, 'document.readyState === "complete"', 15_000);
  await sleep(9000);
  const after = await evaluate(
    cdp,
    "(() => ({ label: document.querySelector('.chatty-label')?.textContent?.trim() || '', text: document.querySelector('.chatty-text')?.textContent || '', flag: localStorage.getItem('freeway.chatty.tour.v2') }))()",
  );
  assert.equal(after.flag, '1', 'the finished tour flag did not survive a reload');
  assert.doesNotMatch(after.label, /^Tour /, `a finished tour restarted itself as "${after.label}" after a reload`);
  assert.doesNotMatch(after.text, /Control board tour/, 'the finished tour opened again after a reload');
}

async function runDismissRace(cdp) {
  // A show schedules its entry frame; a dismiss in the same task must win.
  await evaluate(
    cdp,
    `(() => {
      window.FreewayChatty.show();
      document.querySelector('.chatty-close').click();
      return true;
    })()`,
  );
  await waitForPage(cdp, `document.querySelector('#chatty').hidden === true`, 4000);
  await evaluate(cdp, `window.FreewayChatty.show(); true`);
  await waitForPage(
    cdp,
    `(() => {
      const root = document.querySelector('#chatty');
      return Boolean(root && !root.hidden && root.classList.contains('is-in'));
    })()`,
    4000,
  );
}

async function runTutorDoubleClick(cdp) {
  await evaluate(cdp, `window.FreewayChatty.tutor(); true`);
  await waitForPage(
    cdp,
    `document.querySelector('.chatty-label')?.textContent?.startsWith('Cat school 1/')`,
    5000,
  );
  await evaluate(
    cdp,
    `(() => {
      const pet = document.querySelector('.chatty-pet');
      pet.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      return true;
    })()`,
  );
  await sleep(120);
  const after = await state(cdp);
  assert.match(after.label, /^Cat school /, `the double-click left ${after.label}`);
  assert.ok(after.actions.includes('tutor-next'), 'the double-click removed the lesson controls');
  assert.ok(after.actions.includes('tutor-stop'), 'the double-click removed the Stop control');
  assert.doesNotMatch(after.text, /Wheee/, 'the double-click replaced the lesson with the trick tip');
  await evaluate(cdp, `document.querySelector('[data-chatty-action="tutor-stop"]')?.click(); true`);
  await sleep(120);
}

async function coachState(cdp, text) {
  await evaluate(
    cdp,
    `(() => {
      const input = document.querySelector('#input');
      input.value = ${JSON.stringify(text)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const bubble = document.querySelector('.chatty-bubble');
      if (bubble && !bubble.hidden) document.querySelector('.chatty-pet').click();
      return window.FreewayChatty.coach();
    })()`,
  );
  await waitForPage(
    cdp,
    `document.querySelector('.chatty-label')?.textContent === 'Prompt coach'`,
    4000,
  );
  return state(cdp);
}

async function runPromptCoach(cdp) {
  const weak = await coachState(cdp, 'fix it');
  assert.match(weak.text, /whisker short/, 'the weak draft did not get the prompt coach');
  assert.ok(weak.actions.includes('prompt-lesson'), 'the coach tip has no prompt lesson');

  const shapes = ['sk-' + 'a'.repeat(32), 'gsk_' + 'a'.repeat(30), 'AIza' + 'a'.repeat(30)];
  for (const key of shapes) {
    const warning = await coachState(cdp, key);
    assert.match(warning.text, /credential/, `the coach did not flag ${key.slice(0, 4)}…`);
    assert.ok(!warning.text.includes('a'.repeat(8)), 'the coach repeated the credential');
  }

  const good = await coachState(
    cdp,
    'Add a filename filter to the Files panel. Keep the keyboard shortcuts. Verify by typing log and seeing only log files.',
  );
  assert.match(good.text, /good bones/, 'the strong prompt was not recognised');
  await evaluate(cdp, `document.querySelector('#input').value = ''; window.FreewayChatty.hide(); true`);
}

async function runPlanReady(cdp) {
  await evaluate(
    cdp,
    `(() => {
      document.querySelector('#modePlan')?.click();
      window.FreewayChatty.planReady();
      return true;
    })()`,
  );
  await waitForPage(
    cdp,
    `document.querySelector('.chatty-label')?.textContent === 'Plan ready' &&
     Boolean(document.querySelector('[data-chatty-action="build"]'))`,
    5000,
  );
  const ready = await state(cdp);
  assert.equal(ready.label, 'Plan ready', `plan ready label is ${ready.label}`);
  assert.match(ready.text, /plan is ready/i, 'the plan-ready tip does not explain the hand-off');
  assert.ok(ready.actions.includes('build'), 'the plan-ready tip has no Build action');
  assert.ok(ready.actions.includes('later'), 'the plan-ready tip cannot be deferred');

  const switched = await clickAndSample(cdp, 'build');
  assert.equal(switched.found, true, 'the plan-ready Build action is missing');
  assert.equal(
    await evaluate(cdp, `document.querySelector('#modeBuild').classList.contains('active')`),
    true,
    'the plan-ready Build action did not switch mode',
  );
  assert.match((await state(cdp)).text, /Build mode is on/i, 'the Build hand-off gave no confirmation');
  await evaluate(cdp, `document.querySelector('#modePlan').click(); true`);
}

async function runSwitch(cdp) {
  await openSettings(cdp);
  assert.equal(
    await evaluate(cdp, `document.querySelector('#sChatty').checked`),
    true,
    'the Chatty switch did not load as on',
  );
  await evaluate(cdp, `document.querySelector('#sChatty').checked = false; true`);
  await saveSettings(cdp);
  assert.equal(await evaluate(cdp, 'window.FreewayChatty.isEnabled()'), false, 'Chatty did not switch off');
  assert.equal((await state(cdp)).hidden, true, 'switching Chatty off left her visible');
  assert.equal((await state(cdp)).storage, '0', 'switching Chatty off did not persist');

  await openSettings(cdp);
  assert.equal(
    await evaluate(cdp, `document.querySelector('#sChatty').checked`),
    false,
    'the Chatty switch did not load as off',
  );
  await evaluate(cdp, `document.querySelector('#sChatty').checked = true; true`);
  await saveSettings(cdp);
  assert.equal(await evaluate(cdp, 'window.FreewayChatty.isEnabled()'), true, 'Chatty did not switch back on');
  await waitForPage(
    cdp,
    `(() => {
      const root = document.querySelector('#chatty');
      return Boolean(root && !root.hidden && root.classList.contains('is-in'));
    })()`,
    6000,
  );
  const on = await state(cdp);
  assert.equal(on.storage, '1', 'switching Chatty back on did not persist');
  assert.equal(on.visible, true, 'switching Chatty back on did not show her');
}

async function runDisableDuringTour(cdp) {
  await evaluate(cdp, `window.FreewayChatty.show(); window.FreewayChatty.tour(); true`);
  await waitForPage(
    cdp,
    `(() => {
      const root = document.querySelector('#chatty');
      const spot = [...document.querySelectorAll('.chatty-spot')].find((node) => !node.hidden);
      return Boolean(root && !root.hidden && spot && String(document.querySelector('.chatty-label')?.textContent || '').startsWith('Tour 1/'));
    })()`,
    6000,
  );
  assert.equal((await state(cdp)).spot, true, 'the tour did not show a spotlight before the switch');

  await evaluate(cdp, `window.FreewayChatty.setEnabled(false); true`);
  await sleep(80);
  const off = await state(cdp);
  assert.equal(off.hidden, true, 'switching Chatty off during a tour left her on screen');
  assert.equal(off.spot, false, 'switching Chatty off during a tour left the spotlight behind');
  assert.equal(off.bubble, false, 'switching Chatty off during a tour left the bubble behind');
  assert.equal(off.storage, '0', 'switching Chatty off during a tour did not persist');

  // Leave the next stage a clean, enabled Chatty. The fresh load in runTutor
  // also proves the off/on handoff did not leave a movement class behind.
  await evaluate(cdp, `window.FreewayChatty.setEnabled(true); true`);
}

async function runReduced(cdp, origin) {
  await loadChatty(cdp, origin, true);
  assert.equal(
    await evaluate(cdp, `matchMedia('(prefers-reduced-motion: reduce)').matches`),
    true,
    'the reduced-motion media query did not apply',
  );

  const auto = await state(cdp);
  assert.match(auto.label, /^Tour 1\//, `the reduced-motion control tour did not start (${auto.label})`);
  assert.equal(auto.bubble, true, 'the reduced-motion control tour has no bubble');
  assert.equal(auto.touring, false, 'reduced motion entered the tour movement state');
  assert.equal(auto.anim, 'none', 'reduced motion still animated the tour');

  const step = await clickAndSample(cdp, 'next', 50);
  assert.equal(step.found, true, 'the reduced-motion tour has no Next action');
  assert.equal(step.touring, false, 'reduced motion entered the tour movement state on Next');
  assert.equal(step.anim, 'none', 'reduced motion still animated the next tour stop');
  const nextStop = await state(cdp);
  assert.match(nextStop.label, /^Tour 2\//, `the reduced-motion tour did not advance (${nextStop.label})`);
  assert.notDeepEqual(nextStop.xy, auto.xy, 'reduced motion did not move Chatty between tour stops');
  assert.equal(nextStop.bubble, true, 'the reduced-motion next tour stop has no bubble');

  assert.equal(await clickAction(cdp, 'skip'), true, 'the reduced-motion tour has no End action');
  await waitForPage(cdp, `document.querySelector('#chatty')?.hidden === true`, 5000);
  await evaluate(cdp, `window.FreewayChatty.show(); true`);
  await waitForPage(
    cdp,
    `(() => {
      const root = document.querySelector('#chatty');
      return Boolean(root && !root.hidden && root.classList.contains('is-in'));
    })()`,
    5000,
  );
  const base = await state(cdp);

  await evaluate(cdp, `window.FreewayChatty.tutor(); true`);
  await waitForPage(
    cdp,
    `document.querySelector('.chatty-label')?.textContent === 'Cat school 1/3'`,
    5000,
  );
  await sleep(50);
  const r1 = await state(cdp);
  assert.equal(r1.label, 'Cat school 1/3', `the reduced-motion lesson did not start (${r1.label})`);
  assert.equal(r1.touring, false, 'reduced motion entered the movement state');
  assert.equal(r1.anim, 'none', 'reduced motion still animated the lesson');
  assert.notDeepEqual(r1.xy, base.xy, 'reduced motion did not move Chatty');
  assert.equal(r1.bubble, true, 'the reduced-motion first step has no bubble');

  const next = await clickAndSample(cdp, 'tutor-next', 50);
  assert.equal(next.found, true, 'the reduced-motion step has no Next paw action');
  assert.equal(next.touring, false, 'reduced motion entered the movement state on the next step');
  assert.equal(next.anim, 'none', 'reduced motion still animated the next step');
  const r2 = await state(cdp);
  assert.equal(r2.label, 'Cat school 2/3', `the reduced-motion step label is ${r2.label}`);
  assert.notDeepEqual(r2.xy, r1.xy, 'reduced motion did not move Chatty on the next step');
  assert.equal(r2.bubble, true, 'the reduced-motion second step lost its bubble');
}

async function runTipWalk(cdp, origin) {
  await loadChatty(cdp, origin, false);
  assert.equal(await clickAction(cdp, 'skip'), true, 'the auto-start tour has no End tour action');
  await sleep(300);
  await evaluate(cdp, `window.FreewayChatty.show(); true`);
  await waitForPage(
    cdp,
    `(() => {
      const root = document.querySelector('#chatty');
      return Boolean(root && !root.hidden && root.classList.contains('is-in'));
    })()`,
    5000,
  );
  await sleep(MOVE_SETTLE_MS);
  const before = await state(cdp);

  // A tip that names a control used to place her on it with no travel at all:
  // one frame at the old corner, the next on the button. Users read that as the
  // cat being broken, so the walk is what this stage measures.
  const result = await evaluate(
    cdp,
    `(async () => {
      const root = document.querySelector('#chatty');
      const pet = root.querySelector('.chatty-pet');
      const settings = document.querySelector('#settingsBtn');
      const at = () => {
        const box = pet.getBoundingClientRect();
        return [Math.round(box.x), Math.round(box.y)];
      };
      const frames = [];
      const start = performance.now();
      window.FreewayChatty.tip('Open Settings to switch me off.');
      await new Promise((resolve) => {
        const tick = () => {
          frames.push({
            t: Math.round(performance.now() - start),
            touring: root.classList.contains('is-touring'),
            anim: getComputedStyle(pet).animationName,
            xy: at(),
            pounce: pet.classList.contains('chatty-pounce'),
            bubble: !document.querySelector('.chatty-bubble').hidden,
            spot: Boolean([...document.querySelectorAll('.chatty-spot')].find((node) => !node.hidden)),
          });
          if (performance.now() - start < 1500) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      const rect = settings ? settings.getBoundingClientRect() : null;
      return { frames, settings: rect ? [Math.round(rect.x), Math.round(rect.y)] : null };
    })()`,
  );

  const xs = new Set(result.frames.map((frame) => frame.xy[0]));
  const ys = new Set(result.frames.map((frame) => frame.xy[1]));
  assert.ok(
    Math.max(xs.size, ys.size) >= 4,
    `a tip that names Settings moved in only ${Math.max(xs.size, ys.size)} positions instead of walking`,
  );
  const walking = result.frames.findIndex((frame) => frame.touring && frame.anim === 'chatty-walk');
  assert.ok(walking >= 0, 'the tip never walked to the control it names');
  assert.equal(result.frames[walking].bubble, false, 'the tip bubble was up while she was still walking');
  const landed = result.frames[result.frames.length - 1];
  assert.equal(landed.bubble, true, 'the tip bubble never appeared after the walk');
  assert.ok(landed.spot, 'the ring is not on the control the tip names');
  assert.ok(
    result.frames.slice(walking).some((frame) => frame.pounce),
    'she did not pounce when she landed on the control',
  );
  assert.notDeepEqual(landed.xy, before.xy, 'the tip did not move her at all');
  if (result.settings) {
    const [sx, sy] = result.settings;
    assert.ok(
      Math.abs(landed.xy[0] - sx) < 220 && Math.abs(landed.xy[1] - sy) < 260,
      `she ended at ${landed.xy.join(',')} instead of beside Settings at ${result.settings.join(',')}`,
    );
  }
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'freeway-chatty-'));
  let app;
  let chrome;
  let cdp;
  let appLog = () => '';
  let chromeLog = () => '';
  let stage = 'starting';
  const pageErrors = [];

  const started = await startApp(temp).catch((error) => {
    console.error(error.message);
    fs.rmSync(temp, { recursive: true, force: true });
    process.exit(1);
  });
  app = started.app;
  appLog = started.log;
  const origin = `http://127.0.0.1:${started.port}`;

  try {
    const browser = await launchChrome({
      chromePath: chromeBin,
      userDataDir: path.join(temp, 'chrome'),
      viewport: { width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: false },
      onEvent: (message) => {
        if (message.method !== 'Runtime.exceptionThrown') return;
        const details = message.params?.exceptionDetails;
        const description = details?.exception?.description || details?.text || 'page exception';
        pageErrors.push(description);
      },
    });
    chrome = browser.chrome;
    cdp = browser.cdp;
    chromeLog = browser.log;

    console.log(`  VIEW  ${VIEWPORT.width}x${VIEWPORT.height}`);
    stage = 'first-run control board tour';
    await runTour(cdp, origin);
    console.log('  PASS  all 18 control-board stops, explanations, movement and end');

    stage = 'tour finish';
    await runTourFinish(cdp, origin);
    console.log('  PASS  following the tour to Finish ends it, points at every control and stays done after a reload');

    if (!ONLY) {
      stage = 'Cat school';
      await runTutor(cdp, origin);
      console.log('  PASS  Cat school movement, finish, another lesson and stop');

      stage = 'a tip that names a control';
      await runTipWalk(cdp, origin);
      console.log('  PASS  a tip that names a control walks there, rings it and pounces');

      stage = 'dismiss race and lesson double-click';
      await runDismissRace(cdp);
      await runTutorDoubleClick(cdp);
      console.log('  PASS  quick dismiss wins the entry frame; double-click keeps lesson controls');

      stage = 'prompt coach';
      await runPromptCoach(cdp);
      console.log('  PASS  prompt coach flags weak drafts and provider key shapes');

      stage = 'plan-ready notice';
      await runPlanReady(cdp);
      console.log('  PASS  plan-ready notice and Build shortcut');

      stage = 'switch off during tour';
      await runDisableDuringTour(cdp);
      console.log('  PASS  switching off during a tour clears the pet, bubble and ring');

      stage = 'settings switch';
      await runSwitch(cdp);
      console.log('  PASS  Chatty Settings switch off and on');

      // Chatty's tip promises Alt + H for the saved-chat panel, so the check is
      // the shortcut itself rather than the sentence that describes it.
      stage = 'alt+h shortcut';
      const sidebarState = () =>
        evaluate(
          cdp,
          `(() => {
            const bar = document.querySelector('#sidebar');
            return {
              collapsed: bar.classList.contains('collapsed'),
              closed: document.documentElement.classList.contains('sidebar-closed'),
              open: bar.classList.contains('open'),
            };
          })()`,
        );
      const beforeAltH = await sidebarState();
      await evaluate(
        cdp,
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', altKey: true, bubbles: true })); true`,
      );
      await sleep(250);
      assert.notDeepEqual(
        await sidebarState(),
        beforeAltH,
        'Alt + H did nothing, though Chatty and the palette both promise it',
      );
      await evaluate(
        cdp,
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', altKey: true, bubbles: true })); true`,
      );
      await sleep(250);
      assert.deepEqual(
        await sidebarState(),
        beforeAltH,
        'Alt + H did not bring the saved-chat panel back',
      );
      console.log('  PASS  Alt + H opens and closes the saved-chat panel');

      stage = 'reduced motion';
      await runReduced(cdp, origin);
      console.log('  PASS  reduced-motion lesson moves without the hop');

      // The same tour runs on a phone portrait, a short landscape window and a
      // 320px-wide phone. These are the layouts where a fixed bubble reservation
      // used to clip the tip or cover the control it was explaining.
      for (const [width, height] of RESPONSIVE_VIEWPORTS) {
        stage = `responsive tour ${width}x${height}`;
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await runTour(cdp, origin);
        console.log(`  PASS  responsive ${width}x${height} control-board tour`);
      }
    }

    const unexpected = pageErrors.filter((error) => !/favicon|net::ERR/i.test(error)).slice(0, 5);
    assert.deepEqual(unexpected, [], 'the page reported uncaught errors');
    console.log('PASS browser Chatty: first-run tour, Cat school, Settings switch and reduced motion.');
  } catch (error) {
    console.error(`FAIL browser Chatty (${stage}):`, error.stack || error.message);
    console.error('App exit:', app?.exitCode);
    console.error('Chrome exit:', chrome?.exitCode);
    console.error('App log:', appLog().slice(-4000));
    console.error('Chrome log:', chromeLog().slice(-4000));
    if (pageErrors.length) {
      console.error('Page errors:');
      for (const error of pageErrors) console.error('  ' + error);
    }
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
