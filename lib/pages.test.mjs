// Guards the two single-page apps against a bug class that already shipped once:
// a second `function togglePin(...)` silently replaced the first, so the chat pin
// button called the model-pin code. Browsers report nothing; the wrong feature
// just runs. These checks are cheap and catch it before a release.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAGES = ['public/index.html', 'cloud/public/index.html'];

function load(page) {
  return readFileSync(new URL('../' + page, import.meta.url), 'utf8');
}

// Pull one top-level function out of a page so its policy can be exercised
// without a browser. The cooldown predicate has no nested braces, but this
// scanner keeps the helper honest if it grows one.
function extractFunction(html, name) {
  const start = html.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'missing function ' + name);
  let depth = 0;
  let opened = false;
  for (let i = start; i < html.length; i += 1) {
    if (html[i] === '{') {
      depth += 1;
      opened = true;
    } else if (html[i] === '}') {
      depth -= 1;
      if (opened && depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error('unterminated function ' + name);
}

function definedFunctions(html) {
  // The shared preview core is one IIFE loaded on purpose; its private helpers
  // are not top-level page declarations and must not be counted as collisions.
  const own = html.replace(/<script id="(?:preview-core|chatty-core)">[^]*?<[/]script>/g, '');
  const names = [];
  for (const match of own.matchAll(/(?:^|\s)function\s+([A-Za-z_$][\w$]*)\s*\(/g)) names.push(match[1]);
  return names;
}

for (const page of PAGES) {
  test(page + ': no duplicate top-level function names', () => {
    const seen = new Map();
    for (const name of definedFunctions(load(page))) seen.set(name, (seen.get(name) || 0) + 1);
    const duplicates = [...seen].filter(([, count]) => count > 1).map(([name]) => name);
    assert.deepEqual(duplicates, [], 'declared more than once, the later one silently wins');
  });

  test(page + ': element ids are unique', () => {
    const ids = [...load(page).matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    const counts = new Map();
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
    const duplicates = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
    assert.deepEqual(duplicates, [], 'duplicate element ids make getElementById ambiguous');
  });

  test(page + ': every $("id") resolves to a real element', () => {
    const html = load(page);
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
    const refs = new Set([...html.matchAll(/\$\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]));
    const missing = [...refs].filter((id) => !ids.has(id)).sort();
    assert.deepEqual(missing, []);
  });

  test(page + ': uses Chatty as the shared app mark', () => {
    const html = load(page);
    assert.match(
      html,
      /^  <body>\r?\n    <svg class="chatty-logo-defs"/m,
      'the Chatty symbol is not defined directly in the real body',
    );
    assert.match(html, /<symbol id="chatty-mark" viewBox="0 0 220 240">/, 'the app mark is not Chatty');
    assert.match(
      html,
      /<svg class="brand-mark" viewBox="0 0 220 240"/,
      'the header does not use the Chatty mark',
    );
    assert.equal(
      (html.match(/<use href="#chatty-mark"><\/use>/g) || []).length,
      2,
      'the header and empty state do not both use the Chatty mark',
    );
    assert.match(html, /<div class="empty-mark" aria-hidden="true">/, 'the empty state has no page logo');
    assert.match(html, /stroke="#f4efe3"/, 'the mark has no warm off-white outline');
    assert.doesNotMatch(
      html,
      /class="logo-(?:tile|bubble|chat|dot)"|@keyframes logo-/,
      'the old speech-bubble mark is still present',
    );
    assert.match(html, /<span class="brand-word">Freeway<\/span>/, 'the wordmark is not wrapped for its animation');
    assert.match(html, /@keyframes brand-sheen/, 'the wordmark sheen is not animated');
    assert.match(
      html,
      /\.brand-word\s*\{\s*animation:\s*none !important/,
      'the wordmark ignores prefers-reduced-motion',
    );
    assert.doesNotMatch(html, /\.brand::before|\.empty::before/, 'the old pseudo-element logo is still present');
  });

  test(page + ': the palette can rename and delete the current chat', () => {
    const html = load(page);
    for (const label of ['Rename this chat…', 'Delete this chat…']) {
      // A label in a comment is not a command: it has to be a palette row.
      assert.match(html, new RegExp('label: ["\']' + label + '["\']'), 'not a palette row: ' + label);
    }
  });

  test(page + ': a renamed chat keeps its name', () => {
    const html = load(page);
    // desktop: state.customTitle; cloud: titleOverride keyed to the chat id.
    assert.match(html, /customTitle|titleOverride/, 'no title override, so a rename would be overwritten');
    assert.match(html, /derivedTitle|const derived =/, 'no derived-title fallback for unnamed chats');
    if (page.startsWith('cloud/')) {
      assert.match(
        html,
        /let titleOverride = \{ id: '', title: '' \};/,
        'titleOverride is referenced but never declared; every cloud send throws before the request',
      );
    }
  });

  test(page + ': chats live in a panel docked on the left', () => {
    const html = load(page);
    for (const id of [
      'sidebar',
      'sideBtn',
      'sideClose',
      'sideNew',
      'threadList',
      'threadSearch',
      'threadCount',
      'sideBackdrop',
    ]) {
      assert.match(html, new RegExp('id="' + id + '"'), 'missing #' + id);
    }
    assert.match(
      html,
      /id="sideBtn"[^>]*>☰\s*<span class="chats-label">Chats<\/span>/,
      'the saved-chats control is still an unlabeled icon',
    );
    // Pinned to the left edge, with the app column beside it — not on the right.
    assert.match(html, /inset:\s*0 auto 0 0/, 'the drawer is not anchored to the left edge');
    assert.ok(
      html.indexOf('id="sidebar"') < html.indexOf('class="brand"'),
      'the chats panel must come before the app column',
    );
  });

  test(page + ': an empty chats panel offers a new chat', () => {
    const html = load(page);
    assert.match(html, /thread-empty-new/, 'the empty chats panel has no new-chat action');
    assert.match(html, /Start a new chat/, 'the empty chats panel action has no label');
    assert.match(
      html,
      /if \(!query\) \{[\s\S]{0,260}?Start a new chat/,
      'a search with no matches shows the new-chat action',
    );
    if (page.startsWith('cloud/')) {
      assert.match(
        html,
        /start\.onclick = \(\) => \{[\s\S]{0,120}?startNewChat\(\);[\s\S]{0,80}?closeSidebar\(true\);/,
        'the empty cloud action does not start and dismiss a new chat',
      );
    } else {
      assert.match(
        html,
        /start\.addEventListener\("click", resetThread\)/,
        'the empty desktop action does not start a new chat',
      );
    }
  });

  test(page + ': chat and model pins use separate storage keys', () => {
    const html = load(page);
    const chatPinKey = /const PINNED_KEY = '([^']+)'/.exec(html);
    const modelPinKey = /const PINS_KEY = '([^']+)'/.exec(html);
    if (!chatPinKey || !modelPinKey) return; // page without pins
    assert.notEqual(chatPinKey[1], modelPinKey[1], 'pinning a chat would clobber pinned models');
  });
}

function embeddedChatty(html) {
  const start = html.indexOf('<script id="chatty-core">');
  assert.notEqual(start, -1, 'missing Chatty runtime script');
  const bodyStart = html.indexOf('>', start) + 1;
  const end = html.indexOf('</script>', bodyStart);
  assert.notEqual(end, -1, 'unterminated Chatty runtime script');
  return html.slice(bodyStart, end);
}

test('both editions ship the same Chatty companion with a settings switch', () => {
  const shared = readFileSync(new URL('../shared/chatty.js', import.meta.url), 'utf8');
  assert.ok(
    shared.includes("document.querySelector('dialog[open], .overlay:not(.hidden)')"),
    'Chatty modal guard must not treat hidden aria-modal dialogs as open',
  );
  assert.ok(
    shared.includes('z-index: 2147483000'),
    'Chatty is below the page and panel layers',
  );
  assert.ok(
    shared.includes('z-index: 2147482999'),
    'Chatty tour spotlights are below the page and panel layers',
  );
  assert.ok(
    shared.includes('function fitBubble()') &&
      shared.includes('requestAnimationFrame(fitBubble)') &&
      shared.includes('setTimeout(fitBubble, 260)'),
    'Chatty tips can be clipped by a short viewport',
  );

  assert.ok(
    shared.includes("Psst! I'm Chatty, the Freeway cat."),
    'Chatty does not introduce herself playfully as the Freeway cat',
  );
  assert.ok(
    shared.includes('Click me to see me pounce'),
    'the first greeting does not invite a click',
  );
  assert.ok(
    shared.includes("freeway.chatty.seen.v3"),
    'the playful greeting is hidden by the old seen marker',
  );
  assert.ok(
    shared.includes("freeway.chatty.tour.v1"),
    'first-run tour completion is not remembered',
  );
  assert.ok(shared.includes('const WELCOME_ACTIONS'), 'the first greeting has no actions');
  assert.ok(shared.includes('const TUTOR_ACTIONS'), 'Chatty has no tutor action');
  assert.ok(shared.includes("label: 'Tutor me'"), 'Chatty never offers tutoring');
  assert.ok(shared.includes('const LESSONS ='), 'Chatty has no Cat school lessons');
  assert.ok(shared.includes('function pickLesson()'), 'Chatty cannot pick a lesson');
  assert.ok(shared.includes('function startTutor()'), 'Chatty cannot start a lesson');
  assert.ok(
    shared.includes('function showTutorStep({ move = false } = {})'),
    'Chatty cannot show a lesson step',
  );
  assert.ok(shared.includes('function moveTutorStep()'), 'tutor steps do not move Chatty');
  assert.ok(
    shared.includes('showTutorStep({ move: true })'),
    'advancing a tutor step does not move Chatty',
  );
  assert.ok(shared.includes('function advanceTutor()'), 'Chatty cannot advance a lesson');
  assert.ok(shared.includes('function finishTutor()'), 'Chatty cannot finish a lesson');
  assert.ok(shared.includes('function stopTutor()'), 'Chatty cannot stop a lesson');
  assert.ok(shared.includes("action: 'tutor-next'"), 'lesson steps have no next action');
  assert.ok(shared.includes("action: 'tutor-another'"), 'a finished lesson cannot start another');
  assert.ok(shared.includes("action: 'tutor-stop'"), 'a lesson cannot be stopped');
  assert.ok(shared.includes('Cat school · done'), 'finished lessons have no completion label');
  assert.ok(shared.includes('Purr-fect'), 'Cat school has no catty humor');
  assert.ok(shared.includes('tutor: () => startTutor()'), 'Chatty does not expose tutoring');
  assert.ok(shared.includes('function openSettings()'), 'Chatty cannot open Settings');
  assert.ok(shared.includes('function showSettingsNotes()'), 'Chatty cannot explain Settings');
  assert.ok(shared.includes("action: 'settings'"), 'Chatty never offers Settings');
  assert.ok(shared.includes('settings: () => openSettings()'), 'Chatty does not expose Settings');
  assert.ok(
    shared.includes("document.querySelector('#settingsBtn')"),
    'Chatty cannot find the Settings gear',
  );
  assert.ok(shared.includes("Chatty's settings notes"), 'Chatty has no Settings help heading');
  assert.ok(shared.includes('.chatty-settings-note'), 'Chatty Settings help has no styles');
  assert.ok(shared.includes('const PLAY_MIN_MS'), 'Chatty has no idle play cadence');
  assert.ok(shared.includes('function scheduleBall'), 'Chatty cannot schedule ball play');
  assert.ok(shared.includes('function playBall()'), 'Chatty cannot play with her ball');
  assert.ok(shared.includes('class="chatty-ball"'), 'Chatty has no yarn ball');
  assert.ok(shared.includes('chatty-ball-bounce'), 'the yarn ball does not animate');
  assert.ok(shared.includes('chatty-peek'), 'Chatty never peeks away during play');
  assert.ok(shared.includes('--chatty-clearance'), 'Chatty cannot clear the composer');
  assert.ok(shared.includes('function fitToComposer()'), 'Chatty never measures the composer');
  assert.ok(
    shared.includes("if (tourStep >= 0 || tourBusy || tutorStep >= 0 || (bubbleNode && !bubbleNode.hidden))"),
    'ball play can interrupt a tip, tour or lesson',
  );
  assert.ok(shared.includes('if (!enabled || REDUCE_MOTION) return;'), 'ball play ignores the off switch or reduced motion');
  const lessonsBlock = shared.match(/const LESSONS = \[([\s\S]*?)\n  \];/)?.[1] || '';
  const lessonTitles = [...lessonsBlock.matchAll(/^      title: '(.+)',$/gm)].map(
    (match) => match[1],
  );
  assert.ok(lessonTitles.length >= 6, 'Cat school should offer at least six lessons');
  assert.equal(new Set(lessonTitles).size, lessonTitles.length, 'Cat school repeats a lesson');
  assert.ok(lessonTitles.includes('The Three-Paw Prompt'), 'Cat school has no prompting lesson');
  assert.ok(lessonTitles.includes('Debug Like a Cat'), 'Cat school has no debugging lesson');
  assert.ok(shared.includes('function startTour()'), 'first-run users cannot start the tour');
  assert.ok(shared.includes('tour: () => startTour()'), 'Chatty does not expose the tour');
  assert.ok(shared.includes("selectors: ['#modePlan']"), 'Chatty does not explain Plan');
  assert.ok(shared.includes('chatty-tour-hop'), 'Chatty does not bounce between tour stops');
  assert.ok(shared.includes("classList.add('is-touring')"), 'tour movement has no travelling state');
  assert.ok(shared.includes('--chatty-move-ms'), 'tour movement has no duration');
  assert.ok(shared.includes('const bubbleHeight'), 'tour placement ignores the tip bubble');
  assert.ok(shared.includes('function advanceTour()'), 'the tour cannot be advanced');
  assert.ok(shared.includes('function finishTour()'), 'the tour cannot be finished');
  assert.ok(shared.includes('dataset.chattyAction'), 'tour buttons have no actions');
  assert.ok(shared.includes("'Next stop'"), 'the tour has no next-stop label');
  assert.ok(shared.includes('I have exactly two eyes'), 'Chatty tip library is still shallow');
  const tipsBlock = shared.match(/const TIPS = \[([\s\S]*?)\n  \];/)?.[1] || '';
  const tipMessages = [...tipsBlock.matchAll(/^    '(.+)',$/gm)].map((match) => match[1]);
  assert.ok(tipMessages.length >= 56, 'Chatty should offer at least 56 different tips');
  assert.equal(new Set(tipMessages).size, tipMessages.length, 'Chatty repeats a tip');
  for (const tip of [
    'Press Alt + H to open or close the saved-chat panel.',
    'Branch any reply into a new chat when you want to try a different direction.',
    'A 429 with Retry-After gets one automatic retry; a finished answer never does.',
    'Cloud files live in this browser; desktop files stay in the workspace folder you chose.',
    'The Settings gear is where my switch lives; I can open it and leave you a note.',
    'The Chatty switch hides me only; chats and keys stay exactly where they are.',
  ]) {
    assert.ok(tipMessages.includes(tip), 'Chatty is missing a useful tip: ' + tip);
  }
  assert.ok(shared.includes('const WORKFLOW_TIPS = {'), 'Chatty has no workflow explanations');
  for (const tip of [
    'Plan is read-only:',
    'Build is where files change.',
    'Preview serves this chat’s files in a sandbox.',
    'Keep keys in the Secrets rail, never in chat.',
  ]) {
    assert.ok(shared.includes(tip), 'Chatty is missing a workflow tip: ' + tip);
  }
  assert.ok(shared.includes('function tipContext()'), 'workflow tips are not mode-aware');
  assert.ok(
    shared.includes("if (context && Math.random() < WORKFLOW_CHANCE)"),
    'workflow tips are not preferred when their mode or rail is open',
  );
  assert.ok(shared.includes('@keyframes chatty-tail'), 'Chatty has no tail animation');
  assert.ok(
    !shared.includes('<circle cx="110" cy="120" r="106"'),
    'Chatty is still inside the mint bubble',
  );
  assert.ok(
    shared.includes('stroke="#f4efe3"'),
    'Chatty has no warm off-white outline',
  );
  assert.ok(shared.includes('@keyframes chatty-ear'), 'Chatty has no ear animation');
  assert.ok(shared.includes('const JOKES ='), 'Chatty never tells a joke');
  assert.ok(shared.includes('function pickMessage()'), 'Chatty never mixes jokes with tips');
  assert.ok(shared.includes('@keyframes chatty-head'), 'Chatty has no head tilt');
  assert.ok(shared.includes('@keyframes chatty-paw'), 'Chatty has no paw movement');
  assert.ok(shared.includes('@keyframes chatty-pounce'), 'Chatty has no pounce animation');
  assert.ok(
    shared.includes("petNode.classList.add('chatty-pounce')"),
    'Chatty does not pounce when clicked',
  );
  assert.ok(shared.includes('const WANDER_MIN_MS'), 'Chatty has no wandering cadence');
  assert.ok(shared.includes('function scheduleWander(delay)'), 'Chatty never schedules a wander');
  assert.ok(shared.includes('function wander()'), 'Chatty never moves around');
  assert.ok(shared.includes('pickTip()'), 'Chatty wanders without a useful tip');
  assert.ok(shared.includes('is-wandering'), 'Chatty has no moving transition');
  assert.ok(shared.includes('const TOUR_LIMIT'), 'Chatty has no guided-tour stop limit');
  assert.ok(shared.includes('wanderCount >= TOUR_LIMIT'), 'Chatty can wander forever');
  assert.ok(shared.includes('const TOUR_STOPS'), 'Chatty has no guided tour');
  assert.ok(shared.includes("selectors: ['#modelBtn']"), 'Chatty does not point out the model picker');
  assert.ok(shared.includes("selectors: ['#input']"), 'Chatty does not point out the composer');
  assert.ok(shared.includes("selectors: ['#modeBuild']"), 'Chatty does not explain Build');
  assert.ok(shared.includes("selectors: ['#quickPreview']"), 'Chatty does not point out Preview');
  assert.ok(
    shared.includes("selectors: ['#newChatBtn', '#clearBtn']"),
    'Chatty does not point out New in both editions',
  );
  assert.ok(shared.includes('function placeNear('), 'Chatty does not move beside tour targets');
  assert.ok(shared.includes('function showSpotlight('), 'Chatty does not highlight tour targets');
  assert.ok(shared.includes("className = 'chatty-spot'"), 'Chatty has no spotlight element');
  assert.ok(shared.includes('data-bubble="below"'), 'tour tips cannot flip below Chatty');
  assert.ok(shared.includes('function playReadyChime()'), 'Chatty has no completion chime');
  assert.ok(shared.includes('ready: playReadyChime'), 'Chatty does not expose the completion chime');
  assert.ok(shared.includes('let lastReadyChime = 0'), 'the completion chime can stack');
  assert.ok(
    shared.includes('oscillator.frequency.setValueAtTime(523.25, start)'),
    'the completion chime is not one soft note',
  );
  assert.ok(
    !shared.includes('[659.25, 987.77]'),
    'the completion chime still uses the old two-note alert',
  );
  assert.ok(shared.includes('@keyframes chatty-wink'), 'Chatty never winks at the cursor');
  assert.ok(
    shared.includes('--chatty-head-tilt'),
    'Chatty does not turn her head toward the cursor',
  );
  assert.ok(
    shared.includes('showTip(pickMessage(), 13000, TUTOR_ACTIONS)'),
    'Chatty never uses its mixed tip library with a tutor action',
  );
  assert.ok(shared.includes('@keyframes chatty-heart'), 'Chatty has no click reaction');
  assert.ok(shared.includes("addEventListener('dblclick'"), 'Chatty has no double-click trick');
  assert.ok(shared.includes("addEventListener('focusin'"), 'Chatty does not get out of the way while typing');
  assert.ok(shared.includes('const DISMISS_MIN_MS'), 'Chatty close has no quiet cooldown');
  assert.ok(shared.includes("bubbleNode.addEventListener('click'"), 'the whole Chatty tip cannot be dismissed');
  assert.ok(
    shared.includes('title="Close tip and hide Chatty for a while"'),
    'Chatty close button does not explain that it dismisses the cat',
  );
  for (const page of PAGES) {
    const html = load(page);
    assert.equal(
      embeddedChatty(html),
      '\n' + shared + '\n',
      page + ': embedded Chatty is stale; run node build/sync-preview.mjs',
    );
    assert.ok(
      !html.includes('body.preview-full .chatty'),
      page + ': Chatty is hidden in full-screen preview',
    );
    assert.ok(html.includes('FreewayChatty.setEnabled'), page + ': settings cannot switch Chatty off');
    assert.ok(html.includes('freeway.chatty.enabled'), page + ': Chatty has no saved preference');
    assert.ok(html.includes('FreewayChatty?.ready()'), page + ': no completion chime is wired');
  }
  const desktop = load('public/index.html');
  assert.ok(desktop.includes('id="sChatty"'), 'desktop settings has no Chatty switch');
  assert.ok(desktop.includes('Show Chatty companion'), 'desktop Chatty switch has no label');
  assert.ok(desktop.includes('freeway.chatty.enabled'), 'desktop Chatty switch is not persisted');
  const cloud = load('cloud/public/index.html');
  assert.ok(cloud.includes('id="settingChatty"'), 'cloud settings has no Chatty switch');
  assert.ok(cloud.includes('Show Chatty companion'), 'cloud Chatty switch has no label');
  assert.ok(cloud.includes('freeway.chatty.enabled'), 'cloud Chatty switch is not persisted');
  for (const id of [
    'sideBtn', 'quota', 'attachLabel', 'keyBtn', 'modelBtn', 'input',
    'modePlan', 'modeBuild', 'quickPreview', 'railBtn', 'settingsBtn',
  ]) {
    assert.ok(desktop.includes(`id="${id}"`), `desktop tour target #${id} is missing`);
    assert.ok(cloud.includes(`id="${id}"`), `cloud tour target #${id} is missing`);
  }
  assert.ok(desktop.includes('id="newChatBtn"'), 'desktop tour target #newChatBtn is missing');
  assert.ok(cloud.includes('id="clearBtn"'), 'cloud tour target #clearBtn is missing');

  const stopsBlock = shared.match(/const TOUR_STOPS = \[([\s\S]*?)\n  \];/)?.[1] || '';
  const tourStops = [...stopsBlock.matchAll(/\{\s*selectors: \[([^\]]*)\],\s*tip:/g)].map(
    (match) => [...match[1].matchAll(/'([^']+)'/g)].map((selector) => selector[1]),
  );
  assert.equal(tourStops.length, 11, 'the tour must cover chats, keys/quota, attachments and every primary control');
  for (const page of PAGES) {
    const html = load(page);
    for (const [index, selectors] of tourStops.entries()) {
      assert.ok(
        selectors.some((selector) => html.includes(`id="${selector.slice(1)}"`)),
        `${page}: tour stop ${index + 1} has no target (${selectors.join(', ')})`,
      );
    }
  }

  const noteTargets = {
    desktop: ['sPrompt', 'sTemp', 'sTools', 'sWorkspace', 'sAutoApprove', 'sChatty'],
    cloud: ['keyBtn', 'settingTools', 'settingAutoApprove', 'settingChatty'],
  };
  for (const [edition, ids] of Object.entries(noteTargets)) {
    const html = edition === 'desktop' ? desktop : cloud;
    for (const id of ids) {
      assert.ok(html.includes(`id="${id}"`), `${edition} Chatty settings target #${id} is missing`);
    }
  }
});

test('the cloud tools setting gates the tool loop and both settings explain it', () => {
  const cloud = load('cloud/public/index.html');
  assert.match(
    cloud,
    /readSettings\(\)\.tools \? toolSend\(images\) : streamSend\(images\)/,
    'the cloud page can enter the tool loop with the setting off',
  );
  const toolSend = functionSource(cloud, 'toolSend');
  assert.match(toolSend, /tools: WORKSPACE_TOOLS/, 'the tool loop does not send workspace tools');
  assert.match(cloud, /When on, the model is told to use these tools/, 'cloud settings do not explain the tool prompt');
  const desktop = load('public/index.html');
  assert.match(
    desktop,
    /When this is on, the model is told to use the tools instead of guessing/,
    'desktop settings do not explain the tool prompt',
  );
});

test('cloud writes can bypass Confirm only after an explicit opt-in', () => {
  const cloud = load('cloud/public/index.html');
  assert.match(cloud, /id="settingAutoApprove"/, 'cloud has no browser-write bypass switch');
  assert.match(
    cloud,
    /id="tipCloudAutoApprove"[^>]*>[^<]*write_file[^<]*Deleting files[^<]*still ask/,
    'the browser-write bypass tooltip does not state its scope',
  );
  assert.match(
    cloud,
    /settingAutoApproveHelp[^>]*>Skips Confirm for write_file only; off by default\./,
    'the browser-write bypass visible help is not compact',
  );
  assert.match(
    functionSource(cloud, 'readSettings'),
    /autoApproveWrites: raw\.autoApproveWrites === true/,
    'the browser-write bypass is not off by default',
  );
  const toolSend = functionSource(cloud, 'toolSend');
  assert.match(
    toolSend,
    /name === 'write_file'[\s\S]{0,120}?settings\.autoApproveWrites/,
    'the tool loop ignores the browser-write bypass',
  );
  assert.match(
    toolSend,
    /autoApprovedWrites[\s\S]{0,120}?auto-approved/,
    'the footer does not mark auto-approved writes',
  );
  assert.match(
    cloud,
    /autoApproveWrites: \$\('settingAutoApprove'\)\.checked/,
    'saving Settings drops the browser-write bypass',
  );
  assert.match(
    cloud,
    /\$\('settingAutoApprove'\)\.checked = settings\.autoApproveWrites === true/,
    'the settings modal does not load the saved browser-write bypass',
  );
});

test('desktop auto-approve is opt-in, labelled and persisted', () => {
  const desktop = load('public/index.html');
  assert.match(desktop, /id="sAutoApprove"/, 'desktop has no auto-approve switch');
  assert.match(
    desktop,
    /id="sAutoApprove"[^>]*aria-describedby="sAutoApproveHelp"/,
    'the auto-approve switch is not linked to its visible help',
  );
  assert.match(
    desktop,
    /id="tipAutoApprove"[^>]*>[^<]*Allow \/ Deny card[^<]*workspace folder and program allowlist above still apply/,
    'the auto-approve tooltip does not state the remaining limits',
  );
  assert.match(
    desktop,
    /sAutoApproveHelp[^>]*>Skips Allow cards in Build; Plan stays read-only\./,
    'the auto-approve visible help is not compact',
  );
  assert.match(desktop, /autoApprove: \$\("sAutoApprove"\)\.checked/, 'saving Settings drops auto-approve');
  assert.match(
    desktop,
    /state\.settings\.autoApprove === true/,
    'the settings modal does not load the saved auto-approve choice',
  );
  assert.match(
    desktop,
    /This is a global setting: it applies to every Build workspace until you turn it off/,
    'the auto-approve tooltip does not say that the setting is global',
  );
  assert.match(desktop, /event\.type === "auto_approve"/, 'the transcript never marks an auto-approved action');
  assert.match(
    desktop,
    /event\.type === "auto_approve"[\s\S]{0,160}?log\.push\(/,
    'the auto-approved mark is not kept in the saved transcript',
  );
});

test('desktop screenshot verification is default-on, switchable and displayed', () => {
  const desktop = load('public/index.html');
  assert.match(desktop, /id="sScreenshot"/, 'desktop has no screenshot switch');
  assert.match(desktop, /screenshotChecks: true/, 'screenshot verification is not on by default');
  assert.match(
    desktop,
    /screenshotChecks: \$\("sScreenshot"\)\.checked/,
    'saving Settings drops the screenshot choice',
  );
  assert.match(desktop, /event\.screenshot/, 'the transcript ignores the captured image');
  assert.match(desktop, /className = "tool-shot"/, 'no inline screenshot style hook');
  assert.doesNotMatch(load('cloud/public/index.html'), /screenshot_preview|sScreenshot/);
});

test('desktop preview rediscovers a generated page after a reload', () => {
  const desktop = load('public/index.html');
  assert.match(desktop, /function findPreviewEntry/, 'desktop has no workspace entry discovery');
  assert.match(desktop, /\/api\/fs\/preview-entry/, 'desktop does not ask for the best entry');
  assert.match(functionSource(desktop, 'openPreview'), /findPreviewEntry|preview-entry/, 'Preview does not discover an entry');
  assert.match(functionSource(desktop, 'quickPreview'), /await openPreview\(\)/, 'the header button bypasses discovery');
  assert.match(functionSource(desktop, 'showLocalPreview'), /in memory/, 'the in-memory sample is treated as a real file entry');
});

test('desktop preview falls through a stale remembered entry', () => {
  const desktop = load('public/index.html');
  const open = functionSource(desktop, 'openPreview');
  assert.match(open, /for \(const entry of candidates\)/, 'Preview never tries the remembered or discovered entries');
  assert.match(open, /findPreviewEntry/, 'Preview does not rescan after a failed entry');
  assert.match(open, /if \(attempted\) return true/, 'a failed entry is replaced by the sample');
  assert.match(open, /previewEntry = ""/, 'a stale entry is not cleared');
  assert.match(functionSource(desktop, 'previewWorkspaceFile'), /return false/, 'preview failures are not reported');
});

test('both editions hand the model a preview link and let the user copy it', () => {
  const desktop = load('public/index.html');
  assert.match(desktop, /id="pvCopy"/, 'desktop has no copy-link control');
  assert.match(
    functionSource(desktop, 'copyPreviewLink'),
    /navigator\.clipboard\.writeText/,
    'desktop does not copy the preview link',
  );
  assert.match(desktop, /event\.previewUrl/, 'desktop ignores the link a tool returned');
  assert.match(
    functionSource(desktop, 'createSamplePage'),
    /previewWorkspaceFile\("sample\/index\.html"\)/,
    'a saved sample does not use the real preview server',
  );
  const desktopLink = functionSource(desktop, 'previewLinkForFrame');
  assert.match(desktopLink, /state\.previewMode === "remote"/, 'desktop ignores a remote preview URL');
  assert.match(desktopLink, /FreewayPreview\.pageUrl/, 'desktop has no full-page link for a static preview');
  assert.match(
    functionSource(desktop, 'showLocalPreview'),
    /state\.previewHtml = String\(html\)/,
    'desktop does not keep the rendered page for a full-page link',
  );

  const cloud = load('cloud/public/index.html');
  assert.match(cloud, /name: 'preview_link'/, 'cloud does not offer preview_link');
  assert.match(
    functionSource(cloud, 'previewLinkFor'),
    /#preview=/,
    'cloud preview links do not name the file',
  );
  assert.match(
    functionSource(cloud, 'openPreviewFromHash'),
    /previewSavedHtml/,
    'cloud does not reopen a preview link',
  );
  assert.match(
    functionSource(cloud, 'openPreviewFromHash'),
    /switchRail\('preview'\)/,
    'a cloud preview deep link can fail without opening the panel',
  );
  assert.match(
    functionSource(cloud, 'showMissingPreview'),
    /not saved in this browser/,
    'a missing cloud preview file has no explanation',
  );
  assert.match(cloud, /id="previewCopy"/, 'cloud has no copy-link control');
  assert.match(
    functionSource(cloud, 'standalonePreviewLink'),
    /new URL\('\/preview'/,
    'cloud has no standalone preview page link',
  );
  const setLink = functionSource(cloud, 'setPreviewLink');
  assert.match(setLink, /standalonePreviewLink\(target\)/, 'cloud saved pages do not copy the standalone URL');
  assert.match(setLink, /FreewayPreview\.pageUrl/, 'cloud has no full-page fallback for the sample');
  assert.match(setLink, /open\.href = state\.previewLink/, 'cloud does not open the full-page link');
  const makePreviewLink = new Function(
    'location',
    `${functionSource(cloud, 'previewLinkFor')}\nreturn previewLinkFor;`,
  )({ origin: 'https://app.test', pathname: '/' });
  assert.equal(
    makePreviewLink('site/index.html', true),
    'https://app.test/#preview=site%2Findex.html&full=1',
    'cloud does not produce a usable in-app preview URL',
  );
  const makeStandalone = new Function(
    'location',
    'workspaceKey',
    `${functionSource(cloud, 'standalonePreviewLink')}\nreturn standalonePreviewLink;`,
  )({ origin: 'https://app.test' }, () => 'chat-1');
  assert.equal(
    makeStandalone('site/index.html'),
    'https://app.test/preview?chat=chat-1&file=site%2Findex.html',
    'cloud does not produce a standalone full-page URL',
  );
  const isFullPreview = new Function(
    'location',
    `${functionSource(cloud, 'previewFullFromHash')}\nreturn previewFullFromHash;`,
  )({ hash: '#preview=site%2Findex.html&full=1' });
  assert.equal(isFullPreview(), true, 'cloud does not recognize its own full-page URL');
  assert.match(
    functionSource(cloud, 'showPreview'),
    /setPreviewLink\(saved \? target : '', html\)/,
    'cloud copy link does not receive the rendered page',
  );
  assert.match(cloud, /state\.previewLink = url\.href/, 'cloud does not copy an external preview URL');
  assert.match(
    functionSource(cloud, 'runTool'),
    /Preview link:/,
    'cloud writes never return a preview link',
  );
});

test('cloud preview links stay browser-only and a missing file offers a way forward', () => {
  const cloud = load('cloud/public/index.html');
  for (const id of ['previewLinkScope', 'previewMissing', 'previewMissingFiles', 'previewMissingSample']) {
    assert.match(cloud, new RegExp('id="' + id + '"'), 'missing #' + id);
  }
  const set = functionSource(cloud, 'setPreviewLink');
  assert.match(set, /Standalone preview page/, 'a saved page standalone link is not labelled');
  assert.match(set, /Full-page browser link/, 'a full-page browser fallback is not labelled');
  assert.match(functionSource(cloud, 'previewLinkFor'), /full \? '&full=1'/, 'a full-page app URL is not built');
  assert.match(functionSource(cloud, 'previewFullFromHash'), /full=1/, 'a full-page URL is not recognized');
  assert.match(functionSource(cloud, 'setPreviewFull'), /classList\.toggle\('preview-full'/, 'full-page mode is not toggled');
  assert.match(cloud, /id="previewFullClose"/, 'a full-page preview has no exit control');
  assert.match(cloud, /body\.preview-full #previewFrame/, 'the app preview does not fill the page');
  assert.match(cloud, /const initialFull = previewFullFromHash\(\)/, 'boot loses the full-page flag');
  assert.match(
    cloud,
    /openPreviewFromHash\(initialPreview, initialFull\)/,
    'boot does not reopen a copied full-page link',
  );
  assert.match(
    functionSource(cloud, 'runTool'),
    /standalonePreviewLink\(written\)/,
    'chat preview links do not open the standalone page',
  );
  assert.doesNotMatch(cloud, /previewSignIn|Portable link|previewShare|previewShares/);
  const missing = functionSource(cloud, 'showMissingPreview');
  assert.match(missing, /previewMissingSample/, 'a missing sample cannot be saved');
  assert.match(missing, /previewMissing'\)\.hidden = false/, 'missing-file actions stay hidden');
  assert.match(functionSource(cloud, 'openPreviewFromHash'), /showMissingPreview/, 'the missing state is bypassed');
});

test('the cloud standalone preview renders only the saved page', () => {
  const viewer = readFileSync(new URL('../cloud/public/preview.html', import.meta.url), 'utf8');
  assert.match(viewer, /preview-core\.js/, 'the viewer does not load the shared preview core');
  assert.match(viewer, /indexedDB\.open\('freeway-files', 2\)/, 'the viewer cannot read saved files');
  assert.match(viewer, /workspace:' \+ chat/, 'the viewer ignores the chat file namespace');
  assert.match(viewer, /FreewayPreview\.bundleStatic/, 'the viewer does not inline linked assets');
  assert.match(viewer, /FreewayPreview\.renderMarkdown/, 'the viewer does not render Markdown');
  assert.match(viewer, /sandbox="allow-scripts allow-forms allow-popups"/, 'the page is not sandboxed');
  assert.match(viewer, /position: fixed/, 'the rendered page does not fill the viewport');
  assert.match(
    viewer,
    /\.state\[hidden\][^}]*display:\s*none/,
    'the loading card is not hidden after the page renders',
  );
  assert.match(viewer, /Preview not found/, 'a missing file has no standalone explanation');
  assert.doesNotMatch(viewer, /id="(?:rail|send|composer)"/, 'the viewer still contains the app shell');
});

test('both editions let the user show a preview full screen', () => {
  const desktop = load('public/index.html');
  assert.match(desktop, /id="pvFull"/, 'desktop has no full-screen control');
  assert.match(desktop, /id="pvFullClose"/, 'desktop has no full-screen exit control');
  assert.match(desktop, /body\.preview-full #pvFrame/, 'desktop preview does not fill the page');
  assert.match(
    functionSource(desktop, 'setPreviewFull'),
    /classList\.toggle\(["']preview-full["']/,
    'desktop full-screen mode is not toggled',
  );
  assert.match(
    functionSource(desktop, 'previewHasContent'),
    /getAttribute\(["']src["']\)/,
    'desktop can enter full screen without a preview',
  );
  assert.match(desktop, /\$\("pvFull"\)\.addEventListener\("click"/, 'desktop full-screen control is inert');

  const cloud = load('cloud/public/index.html');
  assert.match(cloud, /id="previewFull"/, 'cloud has no full-screen control');
  assert.match(cloud, /id="previewFullClose"/, 'cloud has no full-screen exit control');
  assert.match(cloud, /body\.preview-full #previewFrame/, 'cloud preview does not fill the page');
  assert.match(
    functionSource(cloud, 'setPreviewFull'),
    /classList\.toggle\('preview-full'/,
    'cloud full-screen mode is not toggled',
  );
  assert.match(cloud, /\$\('previewFull'\)\.onclick/, 'cloud full-screen control is inert');
});

test('the fixed file rail never covers the header actions', () => {
  const desktop = load('public/index.html');
  assert.match(desktop, /inset: var\(--header-h/, 'the fixed rail starts at the viewport top');
  assert.match(functionSource(desktop, 'railOpen'), /syncHeaderHeight/, 'opening the rail does not measure the header');
  assert.match(functionSource(desktop, 'syncHeaderHeight'), /offsetHeight/, 'the header height is not read');
  assert.match(desktop, /new ResizeObserver\(syncHeaderHeight\)/, 'a late header wrap is not tracked');
});

test('file and secret lists scroll independently on a short screen', () => {
  for (const page of PAGES) {
    const html = load(page);
    assert.match(
      html,
      /\.rail-body\s*\{[\s\S]{0,240}?overflow-y:\s*auto/,
      page + ' has no scrolling rail body',
    );
    assert.match(
      html,
      /\.rail-body\s*\{[\s\S]{0,280}?overscroll-behavior:\s*contain/,
      page + ' lets the rail scroll the whole page when it reaches the end',
    );
    assert.match(html, /@media \(max-height:\s*640px\)/, page + ' has no short-screen rail rule');
    if (page.startsWith('cloud/')) {
      assert.match(
        html,
        /#fileList,\s*#secretList\s*\{[^}]*max-height:\s*min\(34vh,\s*300px\)/,
        page + ' lets a long file or secret list push the editor away',
      );
      assert.match(
        html,
        /#fileList,\s*#secretList\s*\{[^}]*overflow-y:\s*auto/,
        page + ' has no scrollable file or secret list',
      );
      assert.match(
        html,
        /#fileList,\s*#secretList\s*\{[^}]*flex:\s*0\s+0\s+auto/,
        page + ' lets the panel squeeze the list to an unusable height',
      );
    } else {
      assert.match(
        html,
        /\.fs-list\s*\{[^}]*max-height:\s*min\(34vh,\s*300px\)/,
        page + ' lets a long file or secret list push the editor away',
      );
      assert.match(
        html,
        /\.fs-list\s*\{[^}]*overflow-y:\s*auto/,
        page + ' has no scrollable file or secret list',
      );
      assert.match(
        html,
        /\.fs-list\s*\{[^}]*flex:\s*0\s+0\s+auto/,
        page + ' lets the panel squeeze the list to an unusable height',
      );
      assert.match(
        html,
        /@media \(max-height:\s*640px\)[\s\S]{0,500}?\.fs-editor\s*\{[^}]*min-height:\s*170px/,
        page + ' shrinks the editor below its textarea on a short screen',
      );
      assert.match(
        functionSource(html, 'revealFileEditor'),
        /scrollIntoView/,
        page + ' opens a file below the fold without revealing it',
      );
      assert.match(
        functionSource(html, 'openFile'),
        /revealFileEditor\(\)/,
        page + ' does not reveal the editor when a file is selected',
      );
      assert.match(
        functionSource(html, 'loadEditorFile'),
        /revealFileEditor\(\{\s*focus:\s*false\s*\}\)/,
        page + ' steals focus while preparing a preview',
      );
    }
  }
});

test('the cloud rail also starts below its header', () => {
  const cloud = load('cloud/public/index.html');
  assert.match(cloud, /top: var\(--header-h/, 'the cloud rail starts at the viewport top');
  assert.match(functionSource(cloud, 'switchRail'), /syncHeaderHeight/, 'opening the cloud rail does not measure the header');
  assert.match(functionSource(cloud, 'syncHeaderHeight'), /offsetHeight/, 'the cloud header height is not read');
  assert.match(cloud, /new ResizeObserver\(syncHeaderHeight\)/, 'a late cloud header wrap is not tracked');
});

test('both editions keep the composer usable on narrow screens', () => {
  for (const page of PAGES) {
    const html = load(page);
    const start = html.indexOf('@media (max-width: 700px)');
    assert.ok(start >= 0, page + ' has no narrow-screen composer rule');
    const block = html.slice(start, start + 450);
    assert.match(block, /\.composer \{ flex-wrap: wrap; \}/, page + ' keeps the composer on one row');
    assert.match(block, /\.composer #input \{ flex: 1 0 100%; \}/, page + ' squeezes the message box beside the controls');
    assert.match(block, /\.composer \.primary \{ margin-left: auto; min-height: 46px; \}/, page + ' leaves Send stranded at the left');
  }
});

test('desktop keeps the header and empty state tidy on a narrow window', () => {
  const desktop = load('public/index.html');
  assert.match(desktop, /<div class="bar-models">/, 'the provider and model pickers are not grouped');
  assert.match(desktop, /<div class="bar-actions">/, 'the header actions are not grouped');
  assert.match(desktop, /id="keyBtn"/, 'the compact key control is missing');
  assert.match(
    desktop,
    /@media \(max-width: 1700px\)[\s\S]{0,320}?grid-template-areas: "side brand actions" "models models models"/,
    'a narrow header still wraps into an accidental third row',
  );
  const render = functionSource(desktop, 'renderThread');
  assert.match(render, /if \(state\.messages\.length \|\| state\.plan\) scrollDown\(true\)/, 'an empty chat still jumps to the bottom');
  assert.match(render, /scrollTop = 0/, 'an empty chat does not open at the top');
  assert.match(
    desktop,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,220}?animation-iteration-count: 1 !important/,
    'streaming motion still loops under reduced motion',
  );
});

test('the composer hides its idle scrollbar and tightens on phones', () => {
  const desktop = load('public/index.html');
  assert.match(
    desktop,
    /textarea\s*\{[^}]*overflow-y:\s*hidden/,
    'the textarea shows a scrollbar before its content overflows',
  );
  const grow = functionSource(desktop, 'autoGrow');
  assert.match(grow, /const border = input\.offsetHeight - input\.clientHeight/, 'auto-grow ignores the textarea border');
  assert.match(grow, /input\.scrollHeight \+ border/, 'the grown height still leaves content clipped by the border');
  assert.match(grow, /input\.style\.overflowY/, 'auto-grow never restores the scrollbar at max height');
  for (const snippet of [
    'footer { padding: 10px 12px calc(12px + env(safe-area-inset-bottom)); }',
    '.composer { gap: 8px; }',
    '.composer #input { min-height: 46px; padding: 10px 14px; border-radius: 12px; }',
    '.attach { min-height: 46px; }',
  ]) {
    assert.ok(desktop.includes(snippet), 'phone composer is missing: ' + snippet);
  }
});

test('both editions scale the reading column from phone to laptop', () => {
  for (const page of PAGES) {
    const html = load(page);
    for (const snippet of [
      '--content: 860px;',
      '@media (min-width: 1200px) { :root { --content: 1040px; } }',
      'max-width: var(--content);',
      'font-size: clamp(15px, 0.25vw + 14.2px, 16.8px)',
      'body { font-size: 16px; }',
      '.composer .primary { margin-left: auto; min-height: 46px; }',
    ]) {
      assert.ok(html.includes(snippet), page + ' is missing: ' + snippet);
    }
    assert.doesNotMatch(html, /max-width: 860px/, page + ' still has a hard-coded content width');
  }
});

test('cloud preview reopens a saved page before the sample', () => {
  const cloud = load('cloud/public/index.html');
  assert.match(cloud, /function findSavedPreview/, 'cloud has no saved-page discovery');
  const quick = functionSource(cloud, 'quickPreview');
  assert.match(quick, /findSavedPreview\(\)/, 'cloud Preview ignores saved pages');
  assert.match(quick, /previewSavedHtml\(entry\)/, 'cloud does not reopen the discovered page');
  assert.ok(
    quick.indexOf('previewSavedHtml(entry)') < quick.indexOf('sample (in memory)'),
    'cloud shows the sample before trying the saved page',
  );
});

test('an HTML write opens the preview without another prompt', () => {
  const desktop = load('public/index.html');
  assert.match(desktop, /function previewWorkspaceFile/, 'desktop has no workspace preview helper');
  assert.match(desktop, /previewWorkspaceFile\(event\.path\)/, 'desktop ignores the written file path');
  const cloud = load('cloud/public/index.html');
  assert.match(cloud, /function previewSavedHtml/, 'cloud has no saved-file preview helper');
  assert.match(cloud, /await previewSavedHtml\(previewName, previewBody\)/, 'cloud upload does not preview HTML');
});

test('both editions use one shared preview core and the same error card', () => {
  for (const page of PAGES) {
    const html = load(page);
    assert.match(html, /<script id="preview-core">/, page + ' has no shared preview core');
    assert.match(html, /FreewayPreview\.bundleStatic/, page + ' does not bundle linked assets');
    assert.match(html, /FreewayPreview\.renderError/, page + ' does not render preview errors');
    assert.match(html, /FreewayPreview\.renderMarkdown/, page + ' does not preview Markdown');
    assert.match(html, /id="(?:pv|preview)Error"/, page + ' has no preview error host');
    assert.doesNotMatch(html, /external files are not loaded/, page + ' still claims linked files are never loaded');
  }
});

test('both editions collect preview runtime problems through the shared bridge', () => {
  for (const page of PAGES) {
    const html = load(page);
    const problems = page.startsWith('cloud/') ? 'previewProblems' : 'pvProblems';
    const title = page.startsWith('cloud/') ? 'previewProblemsTitle' : 'pvProblemsTitle';
    const show = page.startsWith('cloud/') ? 'showPreview' : 'showLocalPreview';
    assert.match(html, new RegExp('id="' + problems + '"'), page + ' has no preview problem host');
    assert.match(html, new RegExp('id="' + title + '"'), page + ' has no preview problem title');
    assert.match(html, /FreewayPreview\.createPreviewMonitor/, page + ' has no shared diagnostics monitor');
    assert.match(html, /FreewayPreview\.withPreviewBridge/, page + ' does not attach the preview bridge');
    assert.match(html, /<script type="application\/json" id="preview-bridge">/, page + ' has no bridge source');
    assert.match(functionSource(html, show), /withPreviewBridge/, page + ' preview path does not use the bridge');
  }
});

test('both editions send build-required source to the adapter card', () => {
  for (const page of PAGES) {
    const html = load(page);
    assert.match(html, /packageJson/, page + ' does not pass project metadata to the preview core');
    assert.match(html, /\.\(ts\|tsx\|jsx\|scss\|sass\|less/, page + ' does not identify build source files');
  }
});

test('both editions hide the preview frame when a build is required', () => {
  for (const page of PAGES) {
    const html = load(page);
    const frameId = page.startsWith('cloud/') ? 'previewFrame' : 'pvFrame';
    const restore = page.startsWith('cloud/') ? 'showPreview' : 'showLocalPreview';
    assert.match(
      html,
      new RegExp(`<iframe id="${frameId}"[^>]*style="[^"]*display:\\s*none`),
      page + ' shows an empty white frame before a preview exists',
    );
    assert.match(
      functionSource(html, 'showPreviewFailure'),
      /style\.display\s*=\s*['"]none['"]/,
      page + ' leaves the frame visible under a BUILD_REQUIRED card',
    );
    assert.match(
      functionSource(html, restore),
      /style\.display\s*=\s*(['"]{2}|['"]block['"])/,
      page + ' does not reveal the frame when a preview succeeds',
    );
  }
});

test('the inlined preview core stays inside its own script', () => {
  for (const page of PAGES) {
    const html = load(page);
    const start = html.indexOf('<script id="preview-core">');
    const end = html.indexOf('</script>', start);
    const firstHeadMeta = html.indexOf('<meta charset="utf-8" />', start);
    assert.ok(start >= 0 && end > start, page + ' has no bounded preview core');
    assert.ok(firstHeadMeta > end, page + ' preview core swallowed the document head');
    assert.ok(end - start < 80_000, page + ' preview core contains more than the shared file');
  }
});

test('2.17.0: the cloud is guest-only and no dev tunnel ships', () => {
  const cloud = load('cloud/public/index.html');
  assert.doesNotMatch(cloud, /style\.dev/, 'a temporary preview host is still in the shipped cloud page');
  assert.match(cloud, /id="desktopLink"/, 'the cloud page has no stable desktop download link');
  assert.match(cloud, /desktopDownloadUrl/, 'the cloud page ignores the configured download URL');
  for (const id of ['askDialog', 'askInput', 'live']) {
    assert.match(cloud, new RegExp('id="' + id + '"'), 'cloud missing #' + id);
  }
  for (const id of ['railShares', 'shareList', 'sharesRefresh', 'sharesRevokeAll', 'previewShare', 'previewSignIn']) {
    assert.equal(cloud.includes('id="' + id + '"'), false, 'removed account UI returned: #' + id);
  }
  assert.doesNotMatch(cloud, /loadPreviewShares|revokeAllPreviewShares|previewShares|accountFiles|threadKeyFor|syncThreads/);
  assert.doesNotMatch(cloud, /auth\/freebuff|Sign in with Freebuff/, 'a Freebuff sign-in path is still in the page');
  assert.match(cloud, /aria-live="polite"/, 'the cloud page has no live status');
  assert.doesNotMatch(cloud, /\bprompt\(/, 'the cloud page still calls the browser prompt');
  assert.doesNotMatch(cloud, /\bconfirm\(/, 'the cloud page still calls the browser confirm');
});

test('2.17.0: the desktop uses real dialogs and a release link', () => {
  const desktop = load('public/index.html');
  assert.match(desktop, /id="askDialog"/, 'desktop has no in-app ask dialog');
  assert.match(desktop, /role="dialog"/, 'desktop overlays have no dialog role');
  assert.match(desktop, /trapModalFocus/, 'desktop does not trap focus in custom overlays');
  assert.match(desktop, /aria-live="polite"/, 'desktop has no live status');
  assert.match(desktop, /https:\/\/github\.com\/zakker111\/freeway\/releases\/latest/, 'desktop has no stable release link');
  assert.doesNotMatch(desktop, /\bprompt\(/, 'the desktop page still calls the browser prompt');
  assert.doesNotMatch(desktop, /\bconfirm\(/, 'the desktop page still calls the browser confirm');
});

test('cloud: chats are the left panel, not a dialog', () => {
  const html = load('cloud/public/index.html');
  assert.equal(html.includes('historyDialog'), false, 'the old chats dialog is back');
  assert.match(html, /\$\('threadList'\)/, 'the cloud panel is not fed by renderHistory');
});

test('cloud: a reload reopens the last chat from this browser', () => {
  const html = load('cloud/public/index.html');
  assert.match(html, /const ACTIVE_KEY = 'orc\.activeThread\.v1'/, 'no active-chat key');
  assert.match(html, /async function restoreActiveChat\(\)/, 'no boot restore');
  assert.match(html, /await restoreActiveChat\(\)/, 'boot never calls the restore');
  assert.match(html, /function threadsKey\(\) \{\s*return THREADS_KEY;/, 'chats do not use the browser key');
  assert.doesNotMatch(html, /threadKeyFor|migrateLegacyThreads|mergeThreads|syncThreads|pushThread|forgetThread/);
  assert.doesNotMatch(html, /state\.user/, 'a guest page still reads a signed-in user');
});

test('cloud: guest history helpers read and write browser storage', () => {
  const html = load('cloud/public/index.html');
  const read = functionSource(html, 'readThreads');
  const write = functionSource(html, 'writeThreads');
  assert.ok(read, 'cloud has no readThreads helper');
  assert.ok(write, 'cloud has no writeThreads helper');

  const storage = { value: null };
  const localStorage = {
    getItem: () => storage.value,
    setItem: (_key, value) => {
      storage.value = value;
    },
  };
  const helpers = new Function(
    'localStorage',
    'threadsKey',
    `${read}\n${write}\nreturn { readThreads, writeThreads };`,
  )(localStorage, () => 'orc.threads');

  assert.deepEqual(helpers.readThreads(), []);
  helpers.writeThreads([{ id: 'chat-1', title: 'Saved chat', messages: [] }]);
  assert.match(storage.value, /chat-1/);
  assert.equal(helpers.readThreads()[0].id, 'chat-1');
  assert.doesNotThrow(() => helpers.writeThreads([]));
});

test('a build-required preview does not auto-open another page', () => {
  const failure = functionSource(load('public/index.html'), 'showPreviewFailure');
  assert.match(failure, /showRailTab\("preview", false\)/, 'the failure card can be replaced by entry discovery');
});

test('both editions offer a first run without a key', () => {
  for (const page of PAGES) {
    const html = load(page);
    // A key wall on the first screen is the fastest way to lose a visitor.
    assert.match(html, /id="keyTry"/, page + ' has no keyless first-run button');
    assert.match(html, /anonymous/, page + ' cannot find its keyless provider');
    assert.doesNotMatch(html, /Try it now — no key/, page + ' still has the vague keyless label');
    assert.match(html, /OVHcloud instead — no key/, page + ' does not name the provider the button switches to');
    assert.match(html, /Cancel keeps/, page + ' does not explain that Cancel keeps the chosen provider');
  }
  assert.match(load('public/index.html'), /provider: free\.id/, 'desktop does not select the keyless provider');
  assert.match(load('cloud/public/index.html'), /applyProvider\(free\.id\)/, 'cloud does not select the keyless provider');
});

test('cloud files upload, preview in a sandbox and stay in the browser', () => {
  const html = load('cloud/public/index.html');
  for (const id of ['fileUpload', 'fileDownload', 'filePreview', 'previewNote', 'previewOpen']) {
    assert.match(html, new RegExp('id="' + id + '"'), 'missing #' + id);
  }
  // The workspace moved off the 5 MB localStorage string.
  assert.match(html, /indexedDB\.open\('freeway-files'/, 'browser files are not using IndexedDB');
  assert.match(html, /srcdoc/, 'HTML preview has no srcdoc path');
  assert.doesNotMatch(html, /\/api\/files|accountUpload|accountFileList|accountRefresh|accountSave/);
  assert.doesNotMatch(html, /sandbox="[^"]*allow-same-origin/, 'an uploaded page would share this origin');
});

test('both editions collect Cloudflare account ids beside the token', () => {
  for (const page of PAGES) {
    const html = load(page);
    for (const id of ['keyAccountField', 'keyAccount', 'keyAccountHelp']) {
      assert.match(html, new RegExp('id="' + id + '"'), page + ' missing #' + id);
    }
  }
  assert.match(load('cloud/public/index.html'), /x-provider-account/, 'cloud does not send the account id');
  assert.match(load('public/index.html'), /value, account/, 'desktop does not send the account id');
});

test('both editions keep the rail tab strip on one line', () => {
  for (const page of PAGES) {
    const html = load(page);
    assert.match(
      html,
      /\.rail-head\s*\{[^}]*flex-wrap:\s*nowrap/,
      page + ' still lets the Health tab wrap onto its own row',
    );
    assert.match(html, /\.rail-tab\s*\{[^}]*min-width:\s*0/, page + ' cannot shrink the rail tabs');
  }
});

function functionSource(html, name) {
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) return '';
  let parens = 0;
  let closeParen = -1;
  for (let i = html.indexOf('(', start); i < html.length; i += 1) {
    if (html[i] === '(') parens += 1;
    else if (html[i] === ')') {
      parens -= 1;
      if (parens === 0) {
        closeParen = i;
        break;
      }
    }
  }
  if (closeParen < 0) return '';
  const bodyStart = html.indexOf('{', closeParen + 1);
  if (bodyStart < 0) return '';
  let depth = 0;
  for (let i = bodyStart; i < html.length; i += 1) {
    if (html[i] === '{') depth += 1;
    else if (html[i] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return '';
}

test('a remembered chats-panel state is applied before the first paint', () => {
  const desktop = load('public/index.html');
  assert.match(desktop, /document\.documentElement\.classList\.add\("sidebar-closed"\)/, 'desktop applies a closed panel after paint');
  assert.match(desktop, /html\.sidebar-closed \.sidebar/, 'desktop has no pre-paint hidden state');
  assert.match(desktop, /classList\.toggle\("sidebar-closed", closed\)/, 'desktop does not keep the state in sync');
  const cloud = load('cloud/public/index.html');
  assert.match(cloud, /document\.documentElement\.classList\.add\(closed \? "sidebar-closed" : "sidebar-docked"\)/, 'cloud resolves the docked state after paint');
  assert.match(cloud, /html\.sidebar-docked body/, 'cloud has no pre-paint docked layout');
  assert.match(cloud, /classList\.toggle\('sidebar-docked', !closed\)/, 'cloud does not keep the docked state in sync');
});

test('the cloud header reserves its wrapped height before configuration arrives', () => {
  const cloud = load('cloud/public/index.html');
  // The version, provider and quota labels are filled after /api/config. A
  // 1366-wide cloud load used to wrap from 64px to 116px and score CLS 0.45.
  assert.match(
    cloud,
    /@media \(min-width: 901px\) and \(max-width: 1149px\) \{\s*header \{ min-height: 168px; \}/,
    'narrow desktops do not reserve the three-row header',
  );
  assert.match(
    cloud,
    /@media \(min-width: 1150px\) and \(max-width: 1800px\) \{\s*header \{ min-height: 116px; \}/,
    'wide desktops do not reserve the two-row header',
  );
});

test('a new chat is visible in the sidebar before its first message', () => {
  const desktop = load('public/index.html');
  const reset = functionSource(desktop, 'resetThread');
  assert.match(reset, /showEmptyThread\(\)/, 'New Chat does not add the empty chat to the list');
  assert.match(
    desktop,
    /function showEmptyThread\(\)[\s\S]*?scheduleSave\(\{ allowEmpty: true \}\)/,
    'the empty chat is not saved for the next load',
  );
  assert.match(
    desktop,
    /if \(state\.messages\.length === 0\) showEmptyThread\(\);/,
    'a first-run draft is not listed at boot',
  );

  const cloud = load('cloud/public/index.html');
  const start = functionSource(cloud, 'startNewChat');
  assert.match(start, /saveThread\(\{ allowEmpty: true \}\)/, 'cloud New Chat does not save its empty thread');
  const save = functionSource(cloud, 'saveThread');
  assert.match(save, /allowEmpty = false/, 'cloud saves cannot opt into an empty thread');
  assert.match(save, /&& !allowEmpty\) return;/, 'cloud still drops empty threads');
});

test('cloud file rows and chat saves do not reference desktop chat pins', () => {
  const html = load('cloud/public/index.html');
  for (const name of ['renderFiles', 'saveThread']) {
    const body = functionSource(html, name);
    assert.ok(body, 'could not isolate ' + name + '()');
    assert.doesNotMatch(
      body,
      /\bpins\b|\btogglePin\b/,
      name + ' must not call desktop chat-pin code',
    );
  }
});

test('both editions offer a sample page and safe local preview', () => {
  const desktop = load('public/index.html');
  const cloud = load('cloud/public/index.html');
  assert.match(cloud, /id="fileSample"/, 'cloud has no sample action');
  assert.match(cloud, /function loadSamplePage\(/, 'cloud sample action has no handler');
  assert.match(desktop, /id="fsSample"/, 'desktop has no sample action');
  assert.match(desktop, /id="fsPreview"/, 'desktop has no local preview action');
  assert.match(
    functionSource(desktop, 'openFile'),
    /state\.fsSavedContent = file\.content/,
    'desktop does not remember the saved editor content',
  );
  assert.match(
    desktop,
    /const dirty = !state\.fsFile \|\| content !== state\.fsSavedContent/,
    'desktop cannot tell a clean saved file from an unsaved edit',
  );
  assert.match(
    desktop,
    /previewWorkspaceFile\(label, dirty \? content : undefined\)/,
    'a clean saved page does not use the real preview server',
  );
  assert.match(desktop, /PV_LOCAL_SANDBOX = "allow-scripts allow-forms allow-popups"/, 'local preview has too much sandbox access');
    assert.match(desktop, /frame\.srcdoc = FreewayPreview\.withPreviewBridge\(String\(html\), previewBridgeSource\(\)\)/, 'desktop preview does not use the bridged srcdoc path');
    assert.match(desktop, /\/api\/preview\/serve/, 'desktop has no local preview server route');
    assert.match(desktop, /PV_SERVER_SANDBOX = "allow-scripts allow-same-origin/, 'served previews cannot use modules');
    assert.match(desktop, /function showServedPreview/, 'desktop cannot display a served preview');
    assert.match(desktop, /Static preview \(/, 'desktop has no static fallback explanation');
  });

test('both editions have a one-click preview action', () => {
  for (const [name, rel] of [
    ['desktop', 'public/index.html'],
    ['cloud', 'cloud/public/index.html'],
  ]) {
    const html = load(rel);
    assert.match(html, /id="quickPreview"/, `${name} has no header preview button`);
    assert.match(html, /function quickPreview\(/, `${name} has no quick preview handler`);
    assert.match(
      html,
      /quickPreview[\s\S]{0,100}(?:addEventListener|onclick)/,
      `${name} does not wire the quick preview handler`,
    );
  }
  assert.match(
    load('public/index.html'),
    /showLocalPreview\(SAMPLE_PREVIEW, "sample \(in memory\)"\)/,
    'desktop quick preview does not show the in-memory sample',
  );
  assert.match(
    load('cloud/public/index.html'),
    /showPreview\(SAMPLE_PREVIEW, 'sample \(in memory\)'\)/,
    'cloud quick preview does not show the in-memory sample',
  );
});

test('a chat owns its files and preview', () => {
  const desktop = load('public/index.html');
  for (const pattern of [
    /workspacePath: null/,
    /function fsParams\(/,
    /chatId: state\.threadId/,
    /\/api\/preview\/close/,
    /state\.threadId = newId\(\)/,
    /resetFilePanel\(\)/,
    /function scheduleFileOnlySave\(/,
    /allowEmpty = false/,
    /scheduleFileOnlySave\(\);/,
  ]) {
    assert.match(desktop, pattern, `desktop is missing per-chat state: ${pattern}`);
  }
  const cloud = load('cloud/public/index.html');
  for (const pattern of [
    /let fileNamespaces = \{\}/,
    /const workspaceKey = \(\) => state\.threadId \|\| 'draft'/,
    /function claimLegacyFiles\(/,
    /function startNewChat\(/,
    /function clearPreview\(/,
    /state\.threadId = newId\(\)/,
    /function saveFileOnlyThread\(/,
    /if \(!state\.messages\.length && !Object\.keys\(readFiles\(\)\)\.length && !allowEmpty\) return;/,
    /function saveThread\(\{ allowEmpty = false \} = \{\}\)/,
    /&& !allowEmpty\) return;/,
    /if \(state\.messages\.length \|\| Object\.keys\(readFiles\(\)\)\.length\) saveThread\(\);/,
    /saveThread\(\{ allowEmpty: true \}\);/,
    /saveFileOnlyThread\(\);/,
  ]) {
    assert.match(cloud, pattern, `cloud is missing per-chat state: ${pattern}`);
  }
});

test('cloud app icons use the Chatty mark', () => {
  for (const file of ['cloud/public/icon.svg', 'cloud/public/icon-maskable.svg']) {
    const icon = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    assert.match(icon, /aria-label="Freeway — Chatty the cat"/, file + ' does not identify Chatty');
    assert.match(icon, /fill="#f4efe3"/, file + ' has no warm tile');
    assert.match(icon, /stroke="#f4efe3"/, file + ' has no off-white outline');
    assert.doesNotMatch(icon, /logo-bubble|logo-tile|logo-dot/, file + ' still contains the old mark');
  }
});

test('cloud service worker fetches the shell before using its cache', () => {
  const sw = readFileSync(new URL('../cloud/public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /request\.mode === 'navigate'/, 'service worker does not detect navigations');
  assert.match(sw, /const fresh = await fetch\(request\)/, 'service worker is still cache-first for the shell');
  assert.match(sw, /cache\.match\('\/'\)/, 'service worker has no offline fallback');
});

test('both editions expose one image attachment with a vision-aware send path', () => {
  for (const page of PAGES) {
    const html = load(page);
    for (const id of ['imageFile', 'imageBar', 'imageThumb', 'imageRemove']) {
      assert.match(html, new RegExp('id="' + id + '"'), page + ' missing #' + id);
    }
    assert.match(html, /accept="image\/png,image\/jpeg,image\/webp"/, page + ' accepts the wrong image types');
    assert.match(html, /toDataURL\(["']image\/jpeg/, page + ' does not compress before sending');
    assert.match(html, /recentImages\(/, page + ' resends every image');
    assert.match(html, /vision/, page + ' does not know which models can see');
  }
});

test('desktop: Plan is the default and Build is one click away', () => {
  const html = load('public/index.html');
  for (const id of ['modePlan', 'modeBuild', 'modeHint']) {
    assert.match(html, new RegExp('id="' + id + '"'), 'missing #' + id);
  }
  assert.match(html, /mode: "plan"/, 'a new chat does not start in Plan');
  assert.match(html, /mode: state\.mode/, 'the chat request does not carry the mode');
  assert.match(html, /PLAN · READ-ONLY/, 'the plan card does not say it is read-only');
  assert.match(html, /function buildApprovedPlan/, 'the plan card has no Build action');
  assert.match(html, /mode: job\.mode[\s\S]*plan: job\.plan/, 'a saved chat does not carry its mode and plan');
});

test('desktop: Build shows a bounded step budget and scaffolds ask first', () => {
  const html = load('public/index.html');
  for (const id of ['buildBudget']) {
    assert.match(html, new RegExp('id="' + id + '"'), 'missing #' + id);
  }
  assert.match(html, /function renderBuildProgress\(/, 'no Build budget renderer');
  assert.match(html, /event\.type === "build"/, 'the page ignores Build progress events');
  assert.match(html, /event\.build/, 'the page ignores the Build limits in meta');
  assert.match(html, /event\.name === "scaffold_project"/, 'the scaffold approval card has no file list');
  assert.match(html, /event\.name === "run_check"/, 'run_check has no approval card');
  assert.match(html, /event\.scriptBody/, 'the run_check card hides the package script body');
  assert.match(html, /event\.program/, 'the run_check card hides the detected program');
  assert.match(html, /renderBuildProgress\(null\)/, 'the budget is never cleared');
});

test('desktop: GitHub connection and clone live in the GitHub rail', () => {
  const html = load('public/index.html');
  for (const id of ['ghStatus', 'ghConnect', 'ghToken', 'ghConnectBtn', 'ghConnected', 'ghDisconnect', 'ghRepos']) {
    assert.match(html, new RegExp('id="' + id + '"'), 'missing #' + id);
  }
  assert.match(html, /id="ghToken" type="password"/, 'the token field is not masked');
  assert.match(html, /\/api\/github\/connect/, 'the page cannot connect GitHub');
  assert.match(html, /\/api\/github\/clone/, 'the page cannot clone a repository');
  assert.match(html, /function cloneGithub\(/, 'no clone action');
  assert.match(html, /event\.name === "github_clone"/, 'the clone approval card is missing');
  assert.match(html, /data-gh-view="runs"/, 'the Actions view is missing');
  assert.match(html, /data-gh-view="releases"/, 'the Releases view is missing');
  assert.match(html, /scopes=repo,workflow/, 'the token link omits the Actions scope');
  assert.match(html, /event\.name\.startsWith\("github_"\)/, 'GitHub write cards have no detail');
  assert.match(html, /id="fsZip"/, 'the workspace ZIP button is missing');
  assert.match(html, /id="exportDocxBtn"/, 'the DOCX export button is missing');
  assert.match(html, /id="exportPdfBtn"/, 'the PDF export button is missing');
  assert.match(html, /api\/workspace\/archive/, 'the page cannot download a workspace ZIP');
  assert.match(html, /api\/export\/document/, 'the page cannot export a document');
});

test('desktop: managed dev servers open in Preview and can be stopped', () => {
  const html = load('public/index.html');
  assert.match(html, /id="devServers"/, 'no dev-server bar');
  assert.match(html, /async function refreshDevServers\(/, 'no dev-server refresh');
  assert.match(html, /function showDevServerPreview\(/, 'no dev-server preview');
  assert.match(html, /\/api\/processes/, 'the page never asks for managed processes');
  assert.match(html, /event\.name === "start_process"/, 'start_process has no approval card');
  assert.match(html, /event\.process/, 'a started process is never shown');
  assert.match(html, /void refreshDevServers\(\)/, 'the bar is not restored on boot');
});

test('cloud: Plan mode is visible, persisted and read-only', () => {
  const cloud = load('cloud/public/index.html');
  for (const id of ['modePlan', 'modeBuild', 'modeHint']) {
    assert.match(cloud, new RegExp(`id=[\"']${id}[\"']`), `cloud is missing ${id}`);
  }
  assert.match(cloud, /mode: "plan"/, 'cloud chats do not default to Plan');
  assert.match(cloud, /state\.mode === "build"/, 'cloud does not gate tool mode on Build');
  assert.match(cloud, /Browser workspace tools are disabled in this mode/, 'cloud Plan prompt is missing');
  assert.match(cloud, /mode: state\.mode/, 'cloud thread does not save its mode');
});

test('both pages parse every inline script', () => {
  for (const page of PAGES) {
    const html = load(page);
    const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
      .filter(([, attrs]) => !/type=["']application\/json["']/i.test(attrs));
    assert.ok(scripts.length > 0, page + ' has no inline scripts');
    scripts.forEach(([, , code], index) => {
      assert.doesNotThrow(
        () => new Function(code),
        page + ' inline script ' + (index + 1) + ' does not parse',
      );
    });
  }
});

test('desktop preview exposes a user capture and PNG download without cloud code', () => {
  const desktop = load('public/index.html');
  assert.match(desktop, /id="pvViewport"/, 'no screenshot viewport selector');
  assert.match(desktop, /id="pvShot"/, 'no capture button');
  assert.match(desktop, /id="pvShotDownload"/, 'no PNG download button');
  assert.match(desktop, /\/api\/preview\/screenshot/, 'the capture button has no endpoint');
  assert.match(desktop, /function capturePreviewShot/, 'no capture handler');
  assert.match(desktop, /previewShot/, 'no in-memory capture state');
  assert.doesNotMatch(load('cloud/public/index.html'), /pvShot|preview\/screenshot/);
});

test('settings pair compact labels with accessible hover and focus help', () => {
  for (const page of PAGES) {
    const html = load(page);
    const buttons = [...html.matchAll(/<button class="qmark"[^>]*>/g)].map((match) => match[0]);
    assert.ok(buttons.length >= 5, page + ': settings have too few help buttons');
    for (const button of buttons) {
      assert.match(button, /type="button"/, page + ': help control is not a button');
      assert.match(button, /aria-label="[^"]+"/, page + ': help button has no accessible name');
      const id = /aria-describedby="([^"]+)"/.exec(button)?.[1];
      assert.ok(id, page + ': help button is not described by a tooltip');
      assert.ok(
        html.includes(`<span class="qtip" id="${id}" role="tooltip">`),
        page + ': missing tooltip #' + id,
      );
    }
    assert.match(html, /\.qmark:hover \+ \.qtip/, page + ': hover does not reveal the help');
    assert.match(html, /\.qmark:focus \+ \.qtip/, page + ': keyboard focus does not reveal the help');
    assert.match(html, /aria-label="More about /, page + ': help controls are not labelled');
  }
});

test('desktop exposes checkpoint undo and repair status', () => {
  const desktop = load('public/index.html');
  assert.match(desktop, /id="undoBtn"/, 'the composer has no undo control');
  assert.match(desktop, /function undoCheckpoint\(/, 'undo has no handler');
  assert.match(desktop, /\/api\/checkpoints\/latest/, 'the page never restores the newest checkpoint');
  assert.match(desktop, /\/api\/checkpoints\/undo/, 'the undo button never calls the server');
  assert.match(desktop, /event\.type === "repair"/, 'repair events are not shown');
  assert.match(desktop, /repair limit reached/, 'the repair limit is not explained');
  assert.doesNotMatch(load('cloud/public/index.html'), /undoBtn|\/api\/checkpoints/, 'cloud has no server checkpoints');
});

test('desktop keeps a model per chat and marks model changes', () => {
  const desktop = load('public/index.html');
  assert.match(functionSource(desktop, 'scheduleSave'), /model: state\.model/, 'chat saves omit the selected model');
  assert.match(functionSource(desktop, 'flushSave'), /model: job\.model/, 'the save request drops the model');
  assert.match(functionSource(desktop, 'openThread'), /result\.thread\.model/, 'opening a chat ignores its saved model');
  assert.match(desktop, /class = "model-switch"|className = "model-switch"/, 'no model divider is created');
  assert.match(functionSource(desktop, 'renderThread'), /createModelSwitchNode/, 'a render never marks a model change');
  assert.doesNotMatch(load('cloud/public/index.html'), /model-switch/, 'cloud has a different chat model lifecycle');
});


test('cloud download announcement is dismissible and the choice persists', () => {
  const html = load('cloud/public/index.html');
  for (const id of ['cloudNotice', 'noticeClose']) {
    assert.match(html, new RegExp('id="' + id + '"'), 'missing #' + id);
  }
  assert.match(html, /aria-label="Dismiss the desktop download announcement"/, 'the close control has no accessible name');
  assert.match(
    html,
    /localStorage\.getItem\('orc\.notice\.download\.v1'\) === 'dismissed'/,
    'the dismissed state is not restored before paint',
  );
  assert.match(
    html,
    /localStorage\.setItem\('orc\.notice\.download\.v1', 'dismissed'\)/,
    'dismissing does not persist',
  );
  assert.match(html, /\$\('noticeClose'\)\.onclick/, 'the close control is not wired');
});


test('the ambient aura never blurs or animates the whole page', () => {
  for (const page of PAGES) {
    const html = load(page);
    const start = html.indexOf('body::before');
    const block = html.slice(start, html.indexOf('}', start));
    // A moving full-screen blur repaints every frame and cut the measured
    // desktop frame rate from ~58 fps to ~8 fps in headless Chrome.
    assert.doesNotMatch(block, /filter\s*:/, page + ' blurs the full-screen aura');
    assert.doesNotMatch(block, /animation\s*:/, page + ' drifts the full-screen aura');
    assert.doesNotMatch(block, /will-change\s*:/, page + ' keeps a full-screen layer alive');
    assert.doesNotMatch(html, /@keyframes\s+ambient-drift/, page + ' keeps the dead aura keyframes');
    assert.match(html, /\.empty-mark\s*\{[^}]*animation:\s*hero-orb/, page + ' lost the small hero motion');
  }
});

test('cooldown predicate waits only for transient limits', () => {
  for (const page of PAGES) {
    const source = extractFunction(load(page), 'autoRetryDelay');
    const delay = new Function('AUTO_RETRY_MAX_MS', source + '; return autoRetryDelay;')(15 * 60_000);
    assert.equal(delay({ code: 'rate-limit', retryAfterMs: 60_000 }), 60_750, page + ' stopped waiting for a provider limit');
    assert.equal(delay({ code: 'upstream_rate', retryAfterMs: 2_000 }), 2_750, page + ' stopped waiting for a provider limit');
    assert.equal(delay({ code: 'rate_limited', retryAfterMs: 60_000 }), 60_750, page + ' does not wait out the address throttle');
    assert.equal(delay({ code: 'visitor_budget', retryAfterMs: 60_000 }), 0, page + ' would hold the tab until midnight');
    assert.equal(delay({ code: 'credit', retryAfterMs: 60_000 }), 0, page + ' retries a non-transient failure');
    assert.equal(delay({ code: 'rate-limit', retryAfterMs: 16 * 60_000 }), 0, page + ' holds an excessively long cooldown');
  }
});

test('cooldown-aware replies retry in place on both editions', () => {
  for (const page of ['public/index.html', 'cloud/public/index.html']) {
    const html = load(page);
    assert.match(html, /function autoRetryDelay\(/, page + ' has no cooldown predicate');
    assert.match(html, /function waitForCooldown\(/, page + ' has no cooldown wait');
    assert.match(html, /Cooling down/, page + ' has no visible countdown');
    assert.match(html, /retryAfterMs/, page + ' does not read the provider delay');
    assert.match(html, /attempt >= 1/, page + ' has no bounded retry');
    if (page.startsWith('cloud/')) {
      assert.match(html, /signal: state\.abort\?\.signal/, page + ' does not abort a tool request');
      assert.match(html, /state\.abort = null/, page + ' leaves a stale abort controller');
      assert.equal(
        (html.match(/state\.abort = new AbortController\(\)/g) || []).length,
        2,
        page + ' does not give tool mode its own abort controller',
      );
    } else {
      assert.match(html, /node\.classList\.remove\("cooling"\)/, page + ' can leave a stopped turn cooling');
    }
  }
});

test('phone chrome: the cloud drawer and short-screen shell stay usable', () => {
  const cloud = load('cloud/public/index.html');
  // The drawer is a modal above the header; otherwise the header eats its
  // close button and the first rows of the thread list.
  assert.match(
    cloud,
    /@media \(max-width: 900px\) \{[\s\S]{0,700}?\.sidebar \{ z-index: 26; \}[\s\S]{0,100}?\.side-backdrop \{ z-index: 25; \}/,
    'cloud drawer is below the header',
  );
  // A 320px phone needs a compact three-row header and a footer that leaves
  // room for the transcript; the old shell left only 24px of chat.
  for (const rule of [
    '.ver, .tag.free, #quitBtn, #modeHint, .hint { display: none; }',
    '#provider { width: auto; max-width: 140px; min-width: 0; flex: 1 1 110px; }',
    '#sideBtn, #settingsBtn, #railBtn { min-width: 40px; justify-content: center; }',
    '#stop:disabled { display: none; }',
    '.notice { max-height: 104px; overflow-y: auto; overscroll-behavior: contain; }',
  ]) {
    assert.ok(cloud.includes(rule), 'cloud phone shell is missing: ' + rule);
  }
  for (const page of PAGES) {
    assert.match(
      load(page),
      /#sideBtn, #settingsBtn, #railBtn \{ min-width: 40px; justify-content: center; \}/,
      page + ' has undersized phone header targets',
    );
  }
});
