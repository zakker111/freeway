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
// The hop is sampled while the 460ms movement is still running. Comparing only
// the final positions would still pass if the animation stopped running.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const chromeBin = findChrome();

if (!chromeBin) {
  console.error('SKIP: set CHROME_BIN to a Chrome or Chromium executable to run this test.');
  process.exit(0);
}

const MOVE_SETTLE_MS = 900;

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* try the next location */
    }
  }
  return '';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      /* not listening yet */
    }
    await sleep(120);
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function waitForJson(url, timeoutMs = 12_000) {
  return (await waitForHttp(url, timeoutMs)).json();
}

function connectCdp(url, onEvent = () => {}, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    let seq = 0;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`timed out connecting to ${url}`));
    }, timeoutMs);

    ws.onerror = (event) => {
      clearTimeout(timer);
      reject(new Error(`CDP WebSocket failed: ${event.message || 'unknown'}`));
    };
    ws.onopen = () => {
      clearTimeout(timer);
      resolve({
        send(method, params = {}) {
          const id = ++seq;
          return new Promise((resolveMessage, rejectMessage) => {
            const timeout = setTimeout(() => {
              pending.delete(id);
              rejectMessage(new Error(`CDP ${method} timed out`));
            }, 15_000);
            pending.set(id, {
              resolve(value) {
                clearTimeout(timeout);
                resolveMessage(value);
              },
              reject(error) {
                clearTimeout(timeout);
                rejectMessage(error);
              },
            });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          ws.close();
        },
      });
    };
    ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!message.id) {
        onEvent(message);
        return;
      }
      if (!pending.has(message.id)) return;
      const job = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) job.reject(new Error(message.error.message || 'CDP error'));
      else job.resolve(message.result);
    };
  });
}

async function waitForPage(cdp, expression, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'page evaluation failed');
    }
    if (result.result?.value) return result.result.value;
    await sleep(100);
  }
  throw new Error(`timed out waiting for: ${expression}`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'page evaluation failed');
  }
  return result.result?.value;
}

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

async function startChrome(temp, onEvent) {
  const debugPort = await freePort();
  let log = '';
  const chrome = spawn(
    chromeBin,
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--remote-allow-origins=*',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${path.join(temp, 'chrome')}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], env: process.env },
  );
  chrome.stderr.on('data', (chunk) => (log += chunk));
  try {
    await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
    const target = targets.find((entry) => entry.type === 'page');
    assert.ok(target?.webSocketDebuggerUrl, 'Chrome did not expose a page target');
    const cdp = await connectCdp(target.webSocketDebuggerUrl, onEvent);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1366,
      height: 768,
      deviceScaleFactor: 1,
      mobile: false,
    });
    return { chrome, cdp, log: () => log };
  } catch (error) {
    chrome.kill('SIGTERM');
    throw new Error(`${error.message}\nChrome log:\n${log.slice(-2000)}`);
  }
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

async function clickAndTrack(cdp, action, delays = [80, 260, 600, 900]) {
  return evaluate(
    cdp,
    `(async () => {
      const button = [...document.querySelectorAll('[data-chatty-action]')]
        .find((node) => node.dataset.chattyAction === ${JSON.stringify(action)});
      if (!button) return { found: false, frames: [] };
      const read = () => {
        const root = document.querySelector('#chatty');
        const pet = root ? root.querySelector('.chatty-pet') : null;
        const bubble = document.querySelector('.chatty-bubble');
        const rect = root ? root.getBoundingClientRect() : null;
        return {
          touring: Boolean(root && root.classList.contains('is-touring')),
          anim: pet ? getComputedStyle(pet).animationName : '',
          label: document.querySelector('.chatty-label')?.textContent?.trim() || '',
          bubble: Boolean(bubble && !bubble.hidden),
          xy: rect ? [Math.round(rect.x), Math.round(rect.y)] : [],
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

function assertMoving(result, label) {
  const { started, frames } = result;
  assert.ok(frames.length >= 3, `${label} did not produce enough movement frames`);
  assert.equal(frames[0].touring, true, `${label} did not enter the movement state`);
  assert.equal(frames[0].bubble, false, `${label} kept the old bubble while travelling`);
  assert.equal(frames[0].anim, 'chatty-tour-hop', `${label} did not start the hop`);
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
      return {
        catInside: rr.left >= 0 && rr.top >= 0 && rr.right <= innerWidth && rr.bottom <= innerHeight,
        bubbleInside: br
          ? br.left >= 0 && br.top >= 0 && br.right <= innerWidth && br.bottom <= innerHeight
          : null,
        catOverlapsTarget: overlaps(rr, sr),
        bubbleOverlapsTarget: br ? overlaps(br, sr) : null,
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
  await waitForPage(
    cdp,
    `(() => {
      const root = document.querySelector('#chatty');
      return Boolean(
        root &&
        !root.hidden &&
        root.classList.contains('is-in') &&
        /Freeway cat/.test(document.querySelector('.chatty-text')?.textContent || '')
      );
    })()`,
    8000,
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

  const welcome = await state(cdp);
  assert.equal(welcome.hidden, false, 'Chatty did not appear');
  assert.equal(welcome.bubble, true, 'Chatty did not open her welcome tip');
  assert.match(welcome.text, /Freeway cat/, 'the welcome tip is missing');
  for (const action of ['tutor', 'settings', 'tour']) {
    assert.ok(welcome.actions.includes(action), `the welcome tip lost the ${action} action`);
  }
  assert.equal(welcome.xy.length, 2, 'Chatty has no screen position');

  const start = await clickAndTrack(cdp, 'tutor');
  assert.equal(start.found, true, 'the welcome tip has no Tutor me action');
  assertMoving(start, 'starting a lesson');
  const s1 = await state(cdp);
  assert.equal(s1.label, 'Cat school 1/3', `the lesson did not start (${s1.label})`);
  assert.equal(s1.bubble, true, 'the first lesson step has no bubble');
  assert.notEqual(s1.pos, welcome.pos, 'starting a lesson did not move Chatty');
  assert.notDeepEqual(s1.xy, welcome.xy, 'starting a lesson did not change her screen position');
  assert.notEqual(s1.text, welcome.text, 'the first lesson step kept the welcome text');

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

async function runTour(cdp) {
  const targets = [
    ['#sideBtn'],
    ['#newChatBtn'],
    ['#modelBtn'],
    ['#quota', '#keyBtn'],
    ['#input'],
    ['#attachLabel'],
    ['#modePlan'],
    ['#modeBuild'],
    ['#quickPreview'],
    ['#railBtn'],
    ['#settingsBtn'],
  ];
  await evaluate(cdp, 'window.FreewayChatty.tour(); true');
  await waitForPage(
    cdp,
    `document.querySelector('.chatty-label')?.textContent?.startsWith('Tour 1/')`,
    5000,
  );

  const positions = [];
  const matched = [];
  for (let index = 0; index < targets.length; index += 1) {
    const number = index + 1;
    await waitForPage(
      cdp,
      `document.querySelector('.chatty-label')?.textContent?.startsWith('Tour ${number}/')`,
      5000,
    );
    await sleep(MOVE_SETTLE_MS);
    const stop = await state(cdp);
    assert.match(stop.label, new RegExp(`^Tour ${number}\\/\\d+$`), `tour stop ${number} is ${stop.label}`);
    assert.equal(stop.bubble, true, `tour stop ${number} has no bubble`);
    assert.equal(stop.spot, true, `tour stop ${number} has no spotlight`);
    const target = await tourTarget(cdp, targets[index]);
    assert.ok(target, `tour stop ${number} highlights no target (${targets[index].join(', ')})`);
    const placement = await tourPlacement(cdp);
    assert.ok(placement, `tour stop ${number} has no placement geometry`);
    assert.equal(placement.catInside, true, `tour stop ${number} put Chatty off screen`);
    assert.equal(placement.bubbleInside, true, `tour stop ${number} put her bubble off screen`);
    assert.equal(
      placement.catOverlapsTarget,
      false,
      `tour stop ${number} parked Chatty over the control she is explaining`,
    );
    assert.equal(
      placement.bubbleOverlapsTarget,
      false,
      `tour stop ${number} covered the control with her bubble`,
    );
    matched.push(target);
    positions.push(stop.xy.join(':'));

    if (number < targets.length) {
      const next = await clickAndTrack(cdp, 'next');
      assert.equal(next.found, true, `tour stop ${number} has no Next action`);
      assertMoving(next, `tour stop ${number} movement`);
    }
  }

  assert.equal(matched.length, targets.length, 'the tour did not reach every stop');
  assert.equal(
    new Set(positions).size,
    targets.length,
    `the tour reused a position (${positions.join(' | ')})`,
  );
  assert.equal(await clickAction(cdp, 'skip'), true, 'the tour has no End tour action');
  await waitForPage(
    cdp,
    `document.querySelector('#chatty')?.hidden === true`,
    5000,
  );
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

async function runReduced(cdp, origin) {
  await loadChatty(cdp, origin, true);
  assert.equal(
    await evaluate(cdp, `matchMedia('(prefers-reduced-motion: reduce)').matches`),
    true,
    'the reduced-motion media query did not apply',
  );

  const welcome = await state(cdp);
  assert.equal(welcome.bubble, true, 'the reduced-motion welcome tip is missing');

  const start = await clickAndSample(cdp, 'tutor', 50);
  assert.equal(start.found, true, 'the reduced-motion welcome has no Tutor me action');
  assert.equal(start.touring, false, 'reduced motion entered the hop state');
  assert.equal(start.anim, 'none', 'reduced motion still animated the hop');
  const r1 = await state(cdp);
  assert.equal(r1.label, 'Cat school 1/3', `the reduced-motion lesson did not start (${r1.label})`);
  assert.notDeepEqual(r1.xy, welcome.xy, 'reduced motion did not move Chatty');
  assert.equal(r1.bubble, true, 'the reduced-motion first step has no bubble');

  const next = await clickAndSample(cdp, 'tutor-next', 50);
  assert.equal(next.found, true, 'the reduced-motion step has no Next paw action');
  assert.equal(next.touring, false, 'reduced motion entered the hop state on the next step');
  assert.equal(next.anim, 'none', 'reduced motion still animated the next hop');
  const r2 = await state(cdp);
  assert.equal(r2.label, 'Cat school 2/3', `the reduced-motion step label is ${r2.label}`);
  assert.notDeepEqual(r2.xy, r1.xy, 'reduced motion did not move Chatty on the next step');
  assert.equal(r2.bubble, true, 'the reduced-motion second step lost its bubble');
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
    const browser = await startChrome(temp, (message) => {
      if (message.method !== 'Runtime.exceptionThrown') return;
      const details = message.params?.exceptionDetails;
      const description = details?.exception?.description || details?.text || 'page exception';
      pageErrors.push(description);
    });
    chrome = browser.chrome;
    cdp = browser.cdp;
    chromeLog = browser.log;

    stage = 'welcome and Cat school';
    await runTutor(cdp, origin);
    console.log('  PASS  welcome, Cat school movement, finish, another lesson and stop');

    stage = 'tour';
    await runTour(cdp);
    console.log('  PASS  all 11 tour stops, targets, movement and end');

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

    stage = 'settings switch';
    await runSwitch(cdp);
    console.log('  PASS  Chatty Settings switch off and on');

    stage = 'reduced motion';
    await runReduced(cdp, origin);
    console.log('  PASS  reduced-motion lesson moves without the hop');

    const unexpected = pageErrors.filter((error) => !/favicon|net::ERR/i.test(error)).slice(0, 5);
    assert.deepEqual(unexpected, [], 'the page reported uncaught errors');
    console.log('PASS browser Chatty: welcome, Cat school, tour, Settings switch and reduced motion.');
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
