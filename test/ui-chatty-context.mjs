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
    // A page Chrome keeps in the background is hidden as far as Chatty is
    // concerned, and every tip path refuses while document.hidden is true.
    await cdp.send('Page.bringToFront').catch(() => {});
    await waitFor('typeof window.FreewayChatty?.tip === "function"');
    await waitFor("document.querySelector('#input') !== null");

    const rootVisible =
      "(() => { const root = document.querySelector('#chatty'); return Boolean(root && !root.hidden && root.classList.contains('is-in')); })()";
    const blockedState = `JSON.stringify({
      hidden: document.hidden,
      visibility: document.visibilityState,
      dialogs: [...document.querySelectorAll('dialog[open]')].map((node) => node.id || node.className),
      overlays: [...document.querySelectorAll('.overlay:not(.hidden)')].map((node) => node.id || node.className),
      enabled: window.FreewayChatty.isEnabled(),
      rootHidden: document.querySelector('#chatty')?.hidden ?? null,
    })`;

    // A clean first run: dismiss the key card and keep the cat out of overlays.
    // The card can render just after the first script runs, and isBlocked() then
    // makes show() a silent no-op, so close overlays and ask again instead of
    // trusting one pass.
    const bringChattyIn = async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
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
        try {
          await waitForPage(cdp, rootVisible, 3000);
          return;
        } catch {
          await sleep(400);
        }
      }
      throw new Error(`the cat never came back in: ${await evaluate(blockedState)}`);
    };
    await bringChattyIn();

    const type = async (text) => {
      await evaluate("document.querySelector('#input').focus(); true");
      await cdp.send('Input.insertText', { text });
      return evaluate("document.querySelector('#input').value");
    };
    // The app restores an emptied draft asynchronously, so a stage that only
    // needs the conversation text sets it in one shot right before asking.
    const setDraft = (text) =>
      evaluate(`(() => {
        const input = document.querySelector('#input');
        input.focus();
        input.value = ${JSON.stringify(text)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return input.value;
      })()`);
    // A tip can be held back by a keystroke the page restored a moment after the
    // draft landed. Ask again for a few seconds, then report what blocked it.
    const askTip = async (attempts = 12) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (await evaluate('window.FreewayChatty.tip()')) return true;
        await sleep(500);
      }
      return false;
    };
    const bubbleOpen = "document.querySelector('.chatty-bubble')?.hidden === false";
    const bubbleText = "document.querySelector('.chatty-text')?.textContent?.trim() || ''";

    await stage('a debugging conversation gets a debugging tip', async () => {
      // Clear any welcome or coach note so the tip under test owns the bubble.
      await bringChattyIn();
      const typed = await setDraft('Fix the bug: this request throws an exception in app.mjs at line 42.');
      assert.match(typed, /throws an exception/, 'the debugging prompt did not reach the composer');
      // Writing the draft is itself typing, so wait out the flow hold it opens.
      await sleep(FLOW_CLEAR_MS);
      const shown = await askTip();
      assert.equal(shown, true, `Chatty refused to show a tip over an idle debugging draft: ${await evaluate(blockedState)}`);
      await waitFor(bubbleOpen, 5000);
      const text = await evaluate(bubbleText);
      assert.ok(
        DEBUGGING_TIPS.includes(text),
        `the tip was not the debugging one for this conversation: ${text}`,
      );
      return { text };
    });

    await stage('typing suppresses a tip', async () => {
      await bringChattyIn();
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

    const resetBubble = () => bringChattyIn();

    await stage('a model outside the family gets a suggestion after a debugging prompt', async () => {
      await resetBubble();
      // The actual model ID is what the family check reads, so this is a real
      // OpenRouter-style id with no Claude or Anthropic in it. The suggestion is
      // one per topic, so no randomness stands between the draft and the tip.
      await evaluate("localStorage.setItem('openrouter.model', 'qwen/qwen3-coder-480b-a35b'); true");
      const shown = await evaluate('window.FreewayChatty.tip()');
      assert.equal(shown, true, 'Chatty refused to show a tip over an idle debugging draft');
      await waitFor(bubbleOpen, 5000);
      const text = await evaluate(bubbleText);
      assert.match(
        text,
        /^You're debugging\. Claude Sonnet tends to give stronger reasoning for tricky bugs \u2014 try it with Ctrl \+ M\.$/,
        `the tip did not suggest a better model for this debugging draft: ${text}`,
      );
      return { text };
    });

    await stage('the suggestion is said once, not on every tip', async () => {
      const shown = await evaluate('window.FreewayChatty.tip()');
      assert.equal(shown, true, 'Chatty stopped answering after the suggestion');
      await waitFor(bubbleOpen, 5000);
      const text = await evaluate(bubbleText);
      assert.doesNotMatch(text, /tends to give/, `the same suggestion repeated: ${text}`);
      return { text };
    });

    await stage('a model in the suggested family gets no suggestion', async () => {
      await resetBubble();
      // Explaining is the one topic that recommends a GPT model, so an OpenAI id
      // is the matching family here; a new topic also re-arms the check.
      await evaluate("localStorage.setItem('openrouter.model', 'openai/gpt-4o'); true");
      await setDraft('Explain how this cache invalidates entries');
      await sleep(FLOW_CLEAR_MS);
      const shown = await evaluate('window.FreewayChatty.tip()');
      assert.equal(shown, true, 'Chatty showed nothing at all');
      await waitFor(bubbleOpen, 5000);
      const text = await evaluate(bubbleText);
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
