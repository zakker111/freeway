#!/usr/bin/env node
// Browser-level regression test for Chatty's contextual tips and flow state.
//
//   CHROME_BIN=/path/to/chrome npm run test:chatty-context
//
// The pages test proves the topic detector and the flow-state predicate exist in
// the source; it cannot prove the page actually shows a debugging tip or that a
// keystroke really holds one back. This boots the real desktop app, types a
// debugging prompt into the real composer, and asks Chatty for a tip through the
// same entry point the page uses. It then types again and checks that no bubble
// opens until the typing pause has passed. Two more stages store a model id and
// check the model-suggestion tip appears only when that id is outside the family
// the detected task recommends.
//
// Reduced motion is emulated so the cat never travels during the run: this test
// is about the bubble, not the walk. It skips (exit 0) when Chrome is missing.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  evaluate as evaluatePage,
  findChrome,
  freePort,
  launchChrome,
  sleep,
  waitForJson,
  waitForPage,
} from './browser.mjs';

const root = path.resolve(import.meta.dirname, '..');
const chromeBin = findChrome();
if (!chromeBin) {
  console.error('SKIP: set CHROME_BIN to a Chrome or Chromium executable to run this test.');
  process.exit(0);
}

const DEBUGGING_TIPS = [
  'Start with the error message, not the whole codebase. The first line that names a file and a line number is your clue.',
  'Change one thing that tests one guess. A giant rewrite is just a box; I will sit in it.',
  'If a reply misses, name one thing to keep and one thing to change. Smaller follow-ups land better.',
];
// Long enough to outlast the 3s flow-state window that typing opens.
const FLOW_CLEAR_MS = 3400;

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'freeway-chatty-context-'));
  const workspace = path.join(temp, 'workspace');
  fs.mkdirSync(workspace);
  const config = path.join(temp, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ workspace }, null, 2));

  let app;
  let chrome;
  let cdp;
  let appLog = '';
  let chromeLog = () => '';
  const results = [];

  const stage = async (name, fn) => {
    try {
      const detail = await fn();
      results.push({ name, ok: true });
      console.log(`  PASS  ${name}${detail ? ' :: ' + JSON.stringify(detail) : ''}`);
    } catch (error) {
      results.push({ name, ok: false });
      console.log(`  FAIL  ${name}`);
      console.log(`        ${error.message}`);
    }
  };

  try {
    const appPort = await freePort();
    app = spawn(
      process.execPath,
      ['app.mjs', '--host', '127.0.0.1', '--port', String(appPort), '--config', config],
      { cwd: root, env: { ...process.env, NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    app.stdout.on('data', (chunk) => (appLog += chunk));
    app.stderr.on('data', (chunk) => (appLog += chunk));
    await waitForJson(`http://127.0.0.1:${appPort}/api/config`);

    const browser = await launchChrome({
      chromePath: chromeBin,
      userDataDir: path.join(temp, 'chrome'),
      viewport: { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false },
    });
    chrome = browser.chrome;
    cdp = browser.cdp;
    chromeLog = browser.log;

    const evaluate = (expression) => evaluatePage(cdp, expression);
    const waitFor = (expression, timeoutMs = 20_000) => waitForPage(cdp, expression, timeoutMs);

    // No travel: the bubble is what this test reads.
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${appPort}/` });
    await waitFor('typeof window.FreewayChatty?.tip === "function"');
    await waitFor("document.querySelector('#input') !== null");

    // A clean first run: dismiss the key card and keep the cat out of overlays.
    await evaluate(
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
        // Past the first-run tour and on the returning-user path, so show()
        // cannot start the tour in the middle of a stage.
        localStorage.setItem('freeway.chatty.tour.v2', '1');
        window.FreewayChatty.hide();
        window.FreewayChatty.show();
        window.FreewayChatty.dismissTip();
        return true;
      })()`,
    );
    await waitFor(
      "(() => { const root = document.querySelector('#chatty'); return Boolean(root && !root.hidden && root.classList.contains('is-in')); })()",
    );

    const type = async (text) => {
      await evaluate("document.querySelector('#input').focus(); true");
      await cdp.send('Input.insertText', { text });
      return evaluate("document.querySelector('#input').value");
    };
    const bubbleOpen = "document.querySelector('.chatty-bubble')?.hidden === false";
    const bubbleText = "document.querySelector('.chatty-text')?.textContent?.trim() || ''";

    await stage('a debugging conversation gets a debugging tip', async () => {
      const typed = await type('Fix the bug: this request throws an exception in app.mjs at line 42.');
      assert.match(typed, /throws an exception/, 'the debugging prompt did not reach the composer');
      await sleep(FLOW_CLEAR_MS);
      // Clear any welcome or coach note so the tip under test owns the bubble.
      await evaluate('window.FreewayChatty.hide(); window.FreewayChatty.show(); window.FreewayChatty.dismissTip(); true');
      await waitFor(
        "(() => { const root = document.querySelector('#chatty'); return Boolean(root && !root.hidden && root.classList.contains('is-in')); })()",
      );
      const shown = await evaluate('window.FreewayChatty.tip()');
      assert.equal(shown, true, 'Chatty refused to show a tip over an idle debugging draft');
      await waitFor(bubbleOpen, 5000);
      const text = await evaluate(bubbleText);
      assert.ok(
        DEBUGGING_TIPS.includes(text),
        `the tip was not the debugging one for this conversation: ${text}`,
      );
      return { text };
    });

    await stage('typing suppresses a tip', async () => {
      await evaluate('window.FreewayChatty.hide(); window.FreewayChatty.show(); window.FreewayChatty.dismissTip(); true');
      await waitFor(
        "(() => { const root = document.querySelector('#chatty'); return Boolean(root && !root.hidden && root.classList.contains('is-in')); })()",
      );
      assert.equal(await evaluate(bubbleOpen), false, 'the bubble was not clear before typing');
      await type(' still digging through the stack trace');
      const shown = await evaluate('window.FreewayChatty.tip()');
      assert.equal(shown, false, 'a tip opened while the user was still typing');
      await sleep(700);
      const open = await evaluate(bubbleOpen);
      assert.equal(open, false, 'a bubble appeared even though the user was typing');
      return { shown };
    });

    await stage('the hold lifts after the typing pause', async () => {
      await sleep(FLOW_CLEAR_MS);
      const shown = await evaluate('window.FreewayChatty.tip()');
      assert.equal(shown, true, 'Chatty stayed silent long after the typing stopped');
      await waitFor(bubbleOpen, 5000);
      return { shown };
    });

    const resetBubble = async () => {
      await evaluate('window.FreewayChatty.hide(); window.FreewayChatty.show(); window.FreewayChatty.dismissTip(); true');
      await waitFor(
        "(() => { const root = document.querySelector('#chatty'); return Boolean(root && !root.hidden && root.classList.contains('is-in')); })()",
      );
    };
    // The suggestion itself is deliberately occasional. A stub keeps the two
    // draws that matter (decline the repeat contextual tip, accept the model
    // suggestion) deterministic instead of leaning on a 7% coincidence.
    const stubRandom = async (values) =>
      evaluate(
        `(() => {
          window.__chattyRandom ??= Math.random;
          const values = ${JSON.stringify(values)};
          Math.random = () => (values.length ? values.shift() : 0.9);
          return true;
        })()`,
      );
    const restoreRandom = () => evaluate('Math.random = window.__chattyRandom; true');

    await stage('a model outside the family gets a suggestion after a debugging prompt', async () => {
      await resetBubble();
      // The actual model ID is what the family check reads, so this is a real
      // OpenRouter-style id with no Claude or Anthropic in it.
      await evaluate("localStorage.setItem('openrouter.model', 'qwen/qwen3-coder-480b-a35b'); true");
      await stubRandom([0.9, 0.1]);
      const shown = await evaluate('window.FreewayChatty.tip()');
      let text = '';
      try {
        assert.equal(shown, true, 'Chatty refused to show a tip over an idle debugging draft');
        await waitFor(bubbleOpen, 5000);
        text = await evaluate(bubbleText);
      } finally {
        await restoreRandom();
      }
      assert.match(
        text,
        /^You're debugging\. Claude Sonnet tends to give stronger reasoning for tricky bugs \u2014 try it with Ctrl \+ M\.$/,
        `the tip did not suggest a better model for this debugging draft: ${text}`,
      );
      return { text };
    });

    await stage('a model in the suggested family gets no suggestion', async () => {
      await resetBubble();
      await evaluate("localStorage.setItem('openrouter.model', 'anthropic/claude-sonnet-4.5'); true");
      await stubRandom([0.9]);
      const shown = await evaluate('window.FreewayChatty.tip()');
      let text = '';
      try {
        assert.equal(shown, true, 'Chatty showed nothing at all');
        await waitFor(bubbleOpen, 5000);
        text = await evaluate(bubbleText);
      } finally {
        await restoreRandom();
      }
      assert.doesNotMatch(text, /tends to give/, `a Claude model still got a Claude suggestion: ${text}`);
      return { text };
    });

    const failed = results.filter((result) => !result.ok);
    assert.deepEqual(failed, [], `${failed.length} contextual-tip stage(s) failed`);
    console.log('PASS browser Chatty: contextual debugging tip, typing hold and its release, model suggestion.');
  } catch (error) {
    console.error('FAIL browser Chatty contextual tips:', error.stack || error.message);
    console.error('App exit:', app?.exitCode);
    console.error('Chrome exit:', chrome?.exitCode);
    console.error('App log:', appLog.slice(-4000));
    console.error('Chrome log:', chromeLog().slice(-4000));
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
