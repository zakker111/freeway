/* Chatty — Freeway's tiny corner companion.
 *
 * One runtime for the desktop and cloud pages. It owns its styles and DOM so
 * both editions stay identical, and it only ever reads/writes the local
 * Chatty preference. It never touches chats, keys or provider requests.
 */
(function (root) {
  'use strict';

  const ENABLED_KEY = 'freeway.chatty.enabled';
  const SEEN_KEY = 'freeway.chatty.seen.v3';
  const TOUR_KEY = 'freeway.chatty.tour.v1';
  const POSITIONS = ['br', 'bl', 'rm', 'lm'];
  const DISMISS_MIN_MS = 2 * 60 * 1000;
  const DISMISS_MAX_MS = 3.5 * 60 * 1000;
  const WANDER_MIN_MS = 12 * 1000;
  const WANDER_MAX_MS = 17 * 1000;
  const TOUR_LIMIT = 2;
  const WELCOME =
    "Psst! I'm Chatty, the Freeway cat. Click me to see me pounce, let me tutor you in Cat school, or open Settings and I'll leave a note. Short lessons, bad puns, no hairballs.";
  const TOUR_INVITE =
    'The quick tour is still ready when you are. I can point out New, the model picker, the composer, Plan/Build, Preview, the rail and Settings.';
  const SETTINGS_ACTION = { action: 'settings', label: 'Settings' };
  const TUTOR_ACTIONS = [{ action: 'tutor', label: 'Tutor me' }, SETTINGS_ACTION];
  const WELCOME_ACTIONS = [
    { action: 'tutor', label: 'Tutor me', primary: true },
    SETTINGS_ACTION,
    { action: 'tour', label: 'Tour' },
    { action: 'later', label: 'Later' },
  ];
  const TIPS = [
    'Press Enter to send, or Shift + Enter for a new line.',
    'Open the command palette with Ctrl + K.',
    'Use Ctrl + M to jump straight to the model picker.',
    'Click the model chip to see every free model.',
    'Pin a chat to keep it at the top of the list.',
    'Attach a text or image file with the buttons by the composer.',
    'Tune temperature and max tokens in Settings.',
    'Need a quieter window? Switch Chatty off in Settings.',
    'No key? OVHcloud works without one.',
    'Plan mode maps the work before Build starts changing files.',
    'Build mode shows its step budget, so there are no surprise marathons.',
    'The retry log shows which free model actually answered.',
    'Preview checks catch missing files before you open the page.',
    'Long chats get folded into a memory note, not thrown away.',
    'Your key never appears in the chat transcript.',
    'Your chats stay on this device. I just live at the edge of the window.',
    'Click me whenever you want another tip.',
    'Click the × or the bubble and I will wander off for a while.',
    'I blink, bob, flick my tail, twitch my ears and tilt my head. It is a busy life.',
    'Try clicking me twice. I have one more trick.',
    'I am not in the way. I am strategically adjacent.',
    'I have exactly two eyes and zero thumbs. The thumbs are the hard part.',
    'I am a cat of few words. This bubble is already a lot.',
    'Cats need naps. I will slip away in a moment.',
    'You can turn me off. I will not take it personally. Probably.',
    'I know where your cursor is. Click me and I will pounce at it.',
    'Free models do the heavy lifting; I supervise.',
    'If a reply is long, use the copy button at the top of it.',
    'A clean slate is one New chat away.',
    'The best tip is the one you close before it gets annoying.',
    'The Files rail is the one room I am not allowed in.',
    'Press Alt + H to open or close the saved-chat panel.',
    'Search saved chats by their messages, not just their titles.',
    'Branch any reply into a new chat when you want to try a different direction.',
    'Export a chat as Markdown from Settings before it gets too long.',
    'Pin a model to keep it near the top of the picker.',
    'A 429 with Retry-After gets one automatic retry; a finished answer never does.',
    'Stop cancels a Build turn, including any cooldown wait.',
    'Keep Auto-approve off unless you trust the workspace with unattended writes.',
    'A page that needs a bundler shows the adapter card instead of a blank iframe.',
    'Preview runs in a sandbox; opening it does not deploy anything.',
    'Files belong to the chat that created them, in both the Files rail and Preview.',
    'Cloud files live in this browser; desktop files stay in the workspace folder you chose.',
    'A cloud provider key stays in this tab and disappears when the tab closes.',
    'Use New chat for a fresh topic; old chats stay in the left panel.',
    'Ctrl + K also renames and deletes chats, not just opens them.',
    'Ask for a tiny lesson: context, goal, constraint, and one proof that it works.',
    'If a reply misses, keep one thing and change one thing; smaller follow-ups land better.',
    'Stuck on a bug? Ask for the smallest next check, not the whole rewrite.',
    'Learning something new? Ask for one example and one counter-example.',
    'Explain an idea back in your own words; the wobble shows you where to study.',
    'Cat school is open: click Tutor me for a short lesson with a purr-actice challenge.',
    'A good prompt points at one spot, like a laser pointer with a deadline.',
    'Tests are catnip for confidence; run the focused one before the whole suite.',
    'The Settings gear is where my switch lives; I can open it and leave you a note.',
    'The Chatty switch hides me only; chats and keys stay exactly where they are.',
  ];
  const WORKFLOW_TIPS = {
    plan: [
      'Plan is read-only: I read the workspace and outline the steps, but change no files.',
      'Plan maps the files and checks first. Switch to Build when you approve the approach.',
      'Plan stays read-only even when Auto-approve is on. Only Build can write.',
    ],
    build: [
      'Build is where files change. Writes and tool actions ask Allow or Deny unless Auto-approve is on.',
      'Build runs with a bounded step and time budget, shown under the composer. Stop ends the turn.',
      'Build can run preview checks and tests; a failed check gets up to two repair attempts.',
    ],
    preview: [
      'Preview serves this chat’s files in a sandbox. Opening it never deploys or publishes anything.',
      'Open Preview from the toolbar or rail. A page that needs a bundler or server gets an adapter card, not a blank frame.',
      'Preview refuses credential files. Keep keys in Secrets instead of .env files.',
    ],
    secrets: [
      'Keep keys in the Secrets rail, never in chat. They stay out of the transcript and workspace.',
      'The Secrets rail lists names and hints, not your key values.',
      'Deleting a secret does not revoke it. If a key leaks, revoke it at the provider and save a new one.',
    ],
  };
  const WORKFLOW_CHANCE = 0.6;
  const JOKES = [
    'I ran the tests in my head. They passed. Please run the real ones.',
    'I found a bug. It was my tail. You are safe.',
    'Nine lives, one production. Let us check the preview first.',
    'Your code has good bones. I would know; I sit on keyboards.',
    'I would review your code, but I am legally a cat.',
    'A clean commit is a happy commit. Mine are mostly paw prints.',
    'Need a break? Stretch. The bugs will still be here. I checked.',
    'I am not ignoring you. I am guarding the edge of the window.',
    'Thumbs are the greatest weakness of cats. That is why I supervise.',
    'Today: mostly code, with a chance of tiny cat.',
    'Good news: the error message is clearer than my handwriting.',
    'If it compiles, ship it. Wait, no. Preview first.',
    'I taught a class on recursion. I will explain it after I explain it.',
    'My lesson on focus was going well until a laser pointer walked in.',
    'I tutor in short bursts: explain, stretch, knock something off the desk.',
    'My teaching style is paws-on. Mostly on the keyboard.',
    'A student asked for the answer. I gave them a ball of yarn and a hint.',
  ];
  const LESSONS = [
    {
      title: 'The Three-Paw Prompt',
      steps: [
        'First paw: name the goal in one sentence. "Add a search box to the Files panel." A vague wish is a laser pointer with no dot.',
        'Second paw: add one constraint. "Filter by filename, keep it keyboard-friendly, no new dependencies." Constraints are catnip for useful answers.',
        'Third paw: name the proof. "It works when I type log and only log files remain." If you cannot check it, I cannot chase it.',
      ],
      finish: 'Purr-fect. That is a testable request, not a wish. Try one; I will supervise from the edge of the keyboard.',
    },
    {
      title: 'Plan Before Pounce',
      steps: [
        'Plan is my stretch before the jump: it reads the files and maps the route without changing anything.',
        'Check that the plan names the right rooms and the check that proves the work. Wrong map, no pounce.',
        'Switch to Build only when the route looks right. Build is the part with claws.',
      ],
      finish: 'Plan first, pounce second. My vet calls it looking before leaping. I call it avoiding the vacuum.',
    },
    {
      title: 'Debug Like a Cat',
      steps: [
        'Start with the error, not the whole codebase. Read the first line that names a file and a line number.',
        'Change one thing that tests one guess. A giant rewrite is just a box; I will sit in it.',
        'Run the focused check. If it passes, run its neighbour. Then say what changed.',
      ],
      finish: 'One paw at a time. Bugs are laser dots with better job security.',
    },
    {
      title: 'Explain It Back',
      steps: [
        'Pick one idea and explain it in three sentences without jargon. The wobbly sentence is the one to study.',
        'Add one tiny example and one counter-example. Cats learn edges by bumping into them.',
        'Ask for a three-question quiz, then answer before peeking. Peeking is for treats, not learning.',
      ],
      finish: 'If you can explain it to a cat, you can explain it to a human. I may still sit on the keyboard.',
    },
    {
      title: 'The Two-Minute Test',
      steps: [
        'Before changing code, name the smallest test that should fail. That is your red dot.',
        'Make the smallest change that turns it green. If it takes three changes, slice the task.',
        'Run it again after the change. A test that passed once is a rumour.',
      ],
      finish: 'Red, green, nap. That is the whole cycle, minus the nap when the tests are slow.',
    },
    {
      title: 'Secret Keeper',
      steps: [
        'Keys go in Secrets, not chat. Chat is a window; Secrets is the locked cupboard.',
        'Never paste a key into a prompt or a file. If it leaks, revoke it at the provider and make a new one.',
        'A .env file is still a file. The Secrets rail keeps me from pretending I have thumbs.',
      ],
      finish: 'Safe, sound, still fluffy. Now rotate the key you definitely did not paste anywhere.',
    },
    {
      title: 'The Follow-Up Purr',
      steps: [
        'When an answer misses, name one thing to keep and one thing to change. "Keep the layout; use a native dialog."',
        'Ask for a smaller slice: "Show only the first failing test." Cats do not eat the whole fish at once.',
        'Finish with a check: "Run the focused test and tell me the result." Otherwise we are batting at the screen.',
      ],
      finish: 'Small corrections, warm laps, working software. That is the follow-up purr.',
    },
    {
      title: 'Review Like a Cat',
      steps: [
        'Read the diff for behavior first. What can it do now that it could not before?',
        'Check the unhappy path: empty input, failed request, missing file. That is where the mice hide.',
        'Ask for one concrete fix and one test. "Handle a missing file and cover it with a focused test."',
      ],
      finish: 'A good review is a gentle paw on the shoulder, not a swat. Unless it is a null. Then swat.',
    },
  ];
  const TOUR_STOPS = [
    {
      selectors: ['#newChatBtn', '#clearBtn'],
      tip: 'New starts a clean chat. Your saved chats stay in the panel, so start fresh whenever you like.',
    },
    {
      selectors: ['#modelBtn'],
      tip: 'This is the model picker. Every model inside is free; press Ctrl + M to open it.',
    },
    {
      selectors: ['#input'],
      tip: 'This is where we chat. Type here and press Enter to send; Shift + Enter adds a line.',
    },
    {
      selectors: ['#modeBuild'],
      tip: 'Plan maps the work. Build is where I make files; switch here when you are ready to build.',
    },
    {
      selectors: ['#quickPreview'],
      tip: 'Preview opens what we made. The rail next to it holds Files, Preview and Health.',
    },
    {
      selectors: ['#railBtn'],
      tip: 'The rail lives here: Files, Secrets, GitHub, Preview and Health.',
    },
    {
      selectors: ['#settingsBtn'],
      tip: 'Settings holds your key, workspace and my own switch. This is the gear.',
    },
  ];
  const FUNNY_CHANCE = 0.3;

  const REDUCE_MOTION =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const STYLE = `
    .chatty {
      position: fixed;
      z-index: 2147483000;
      width: 84px;
      opacity: 0;
      transform: var(--chatty-enter, translateY(9px)) scale(.96);
      transform-origin: 50% 100%;
      transition: opacity .22s ease, transform .28s cubic-bezier(.2,.8,.2,1);
      pointer-events: none;
    }
    .chatty[hidden] { display: none; }
    .chatty.is-in { opacity: 1; transform: translate(0, 0) scale(1); }
    .chatty.is-in.is-wandering {
      opacity: .12;
      transform: translateY(8px) scale(.92);
    }
    .chatty.is-in.is-wandering .chatty-pet { pointer-events: none; }
    .chatty-spot {
      position: fixed;
      z-index: 2147482999;
      pointer-events: none;
      border: 1.5px dashed var(--accent, #f0f0f0);
      border-radius: 10px;
      opacity: 0;
      transition: opacity .18s ease;
    }
    .chatty-spot.is-on { opacity: .68; }
    .chatty-spot[hidden] { display: none; }
    .chatty[data-pos="br"], .chatty[data-pos="rm"] { --chatty-enter: translate(14px, 8px); }
    .chatty[data-pos="bl"], .chatty[data-pos="lm"] { --chatty-enter: translate(-14px, 8px); }
    .chatty[data-pos="br"] { right: 16px; bottom: max(170px, 14dvh); }
    .chatty[data-pos="bl"] { left: 16px; bottom: max(170px, 14dvh); }
    .chatty[data-pos="rm"] { right: 16px; top: 46%; }
    .chatty[data-pos="lm"] { left: 16px; top: 46%; }
    .chatty-pet {
      display: block;
      width: 84px;
      height: auto;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: none;
      box-shadow: none;
      color: inherit;
      cursor: pointer;
      pointer-events: auto;
      transform-origin: 50% 100%;
      -webkit-tap-highlight-color: transparent;
      filter: drop-shadow(0 10px 18px rgba(0, 0, 0, .30));
      transition: filter .22s ease;
    }
    .chatty-pet:hover {
      background: none;
      border-color: transparent;
      filter: drop-shadow(0 12px 22px rgba(0, 0, 0, .36)) saturate(1.08);
    }
    .chatty-pet:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 4px;
    }
    .chatty-art {
      display: block;
      width: 100%;
      height: auto;
      overflow: visible;
      transform: rotate(var(--chatty-tilt, 0deg));
      transform-origin: 50% 70%;
      transition: transform .22s ease;
    }
    .chatty.is-in .chatty-pet { animation: chatty-bob 4.5s ease-in-out infinite; }
    .chatty.is-in .chatty-eye { animation: chatty-blink 6.8s ease-in-out infinite; }
    .chatty.is-in .chatty-tail { animation: chatty-tail 5.8s ease-in-out infinite; }
    .chatty.is-in .chatty-ear-left { animation: chatty-ear 8.6s ease-in-out infinite; }
    .chatty.is-in .chatty-ear-right { animation: chatty-ear 9.8s ease-in-out 1.4s infinite; }
    .chatty.is-in .chatty-head { animation: chatty-head 10.6s ease-in-out infinite; }
    .chatty.is-in .chatty-paw-left { animation: chatty-paw 7.8s ease-in-out infinite; }
    .chatty.is-in .chatty-paw-right { animation: chatty-paw 9.2s ease-in-out 2.1s infinite; }
    .chatty.is-in .chatty-pet.chatty-pounce { animation: chatty-pounce .62s cubic-bezier(.2,.8,.2,1); }
    .chatty.is-in .chatty-pet.chatty-spin { animation: chatty-spin .82s cubic-bezier(.2,.8,.2,1); }
    .chatty-pet.chatty-pounce { animation: chatty-pounce .62s cubic-bezier(.2,.8,.2,1); }
    .chatty.is-in.is-winking .chatty-eye-right { animation: chatty-wink .58s ease; }
    .chatty-iris { transition: transform .18s ease-out; }
    .chatty-eye { transform-box: fill-box; transform-origin: center; }
    .chatty-ear { transform-box: fill-box; transform-origin: 50% 100%; }
    .chatty-tail { transform-box: view-box; transform-origin: 154px 198px; }
    .chatty-head { transform-box: view-box; transform-origin: 110px 158px; }
    .chatty-paw { transform-box: fill-box; transform-origin: center; }
    .chatty-bubble {
      position: absolute;
      right: 0;
      bottom: calc(100% + 10px);
      width: max-content;
      max-width: 238px;
      min-width: 174px;
      padding: 10px 40px 11px 13px;
      border: 1px solid var(--line-2, #3f3f3f);
      border-radius: 14px;
      background: var(--surface-2, #1d1d1d);
      box-shadow: var(--shadow-md, 0 10px 28px rgba(0, 0, 0, .55));
      color: var(--text, #e8e8e8);
      font: 12.5px/1.45 "Segoe UI", system-ui, -apple-system, sans-serif;
      text-align: left;
      z-index: 3;
      pointer-events: auto;
      cursor: pointer;
      animation: chatty-tip-in .2s ease-out both;
    }
    .chatty-bubble[hidden] { display: none; }
    .chatty-bubble::after {
      content: "";
      position: absolute;
      right: 18px;
      bottom: -5px;
      width: 9px;
      height: 9px;
      background: var(--surface-2, #1d1d1d);
      border-right: 1px solid var(--line-2, #3f3f3f);
      border-bottom: 1px solid var(--line-2, #3f3f3f);
      transform: rotate(45deg);
    }
    .chatty[data-bubble="below"] .chatty-bubble {
      top: calc(100% + 10px);
      bottom: auto;
    }
    .chatty[data-bubble="below"] .chatty-bubble::after {
      top: -5px;
      bottom: auto;
      border-right: 0;
      border-bottom: 0;
      border-top: 1px solid var(--line-2, #3f3f3f);
      border-left: 1px solid var(--line-2, #3f3f3f);
    }
    .chatty[data-bubble-side="left"] .chatty-bubble { right: auto; left: 0; }
    .chatty[data-bubble-side="left"] .chatty-bubble::after { right: auto; left: 18px; }
    .chatty[data-pos="bl"] .chatty-bubble,
    .chatty[data-pos="lm"] .chatty-bubble { right: auto; left: 0; }
    .chatty[data-pos="bl"] .chatty-bubble::after,
    .chatty[data-pos="lm"] .chatty-bubble::after { right: auto; left: 18px; }
    .chatty-label {
      display: block;
      margin-bottom: 2px;
      color: var(--accent, #f0f0f0);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .chatty-text { display: block; color: var(--muted, #b3b3b3); }
    .chatty-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    .chatty-actions[hidden] { display: none; }
    .chatty-action {
      min-height: 26px;
      padding: 4px 8px;
      border: 1px solid var(--line-2, #3f3f3f);
      border-radius: 999px;
      background: var(--surface-3, #262626);
      box-shadow: none;
      color: var(--text, #e8e8e8);
      font: 600 11px/1.2 "Segoe UI", system-ui, -apple-system, sans-serif;
      cursor: pointer;
      touch-action: manipulation;
    }
    .chatty-action:hover {
      background: var(--surface-2, #1d1d1d);
      border-color: var(--line-2, #3f3f3f);
    }
    .chatty-action.primary {
      border-color: transparent;
      background: var(--accent, #f0f0f0);
      color: var(--accent-ink, #101010);
    }
    .chatty-action.primary:hover { filter: brightness(1.06); }
    .chatty-action:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .chatty-settings-note {
      margin: 0 0 12px;
      padding: 10px 12px;
      border: 1px solid var(--line-2, #3f3f3f);
      border-radius: 12px;
      background: var(--surface-3, #262626);
      color: var(--text, #e8e8e8);
      font: 12px/1.45 "Segoe UI", system-ui, -apple-system, sans-serif;
    }
    .chatty-settings-note__head {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .chatty-settings-note__head strong {
      color: var(--accent, #f0f0f0);
      font-size: 11px;
      letter-spacing: .06em;
      text-transform: uppercase;
    }
    .chatty-settings-note__close {
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      margin-left: auto;
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: transparent;
      box-shadow: none;
      color: var(--dim, #8f8f8f);
      font: 16px/1 "Segoe UI", system-ui, sans-serif;
      cursor: pointer;
    }
    .chatty-settings-note__close:hover {
      background: var(--surface-2, #1d1d1d);
      color: var(--text, #e8e8e8);
    }
    .chatty-settings-note__text {
      margin: 0;
      color: var(--muted, #b3b3b3);
    }
    .chatty-settings-note__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    .chatty-settings-note__button {
      min-height: 26px;
      padding: 4px 8px;
      border: 1px solid var(--line-2, #3f3f3f);
      border-radius: 999px;
      background: var(--surface-2, #1d1d1d);
      box-shadow: none;
      color: var(--text, #e8e8e8);
      font: 600 11px/1.2 "Segoe UI", system-ui, -apple-system, sans-serif;
      cursor: pointer;
    }
    .chatty-settings-note__button:hover {
      background: var(--surface-3, #262626);
      border-color: var(--line-2, #3f3f3f);
    }
    .chatty-settings-note__button:focus-visible,
    .chatty-settings-note__close:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .chatty-close {
      position: absolute;
      top: 3px;
      right: 3px;
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: transparent;
      box-shadow: none;
      color: var(--dim, #8f8f8f);
      font: 17px/1 "Segoe UI", system-ui, sans-serif;
      cursor: pointer;
      touch-action: manipulation;
    }
    .chatty-close:hover {
      background: var(--surface-3, #262626);
      border-color: transparent;
      color: var(--text, #e8e8e8);
    }
    .chatty-close:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .chatty-heart {
      position: absolute;
      left: 50%;
      top: 34%;
      z-index: 1;
      color: #ff8095;
      font: 700 18px/1 "Segoe UI", system-ui, sans-serif;
      pointer-events: none;
      opacity: 0;
      text-shadow: 0 0 8px rgba(255, 128, 149, .45);
      animation: chatty-heart 1.15s ease-out forwards;
    }
    @keyframes chatty-bob {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-4px); }
    }
    @keyframes chatty-pounce {
      0% { transform: translateY(0) scale(1) rotate(0); }
      18% { transform: translateY(4px) scale(1.06, .92) rotate(-1.5deg); }
      42% { transform: translateY(-16px) scale(.95, 1.06) rotate(3deg); }
      58% { transform: translateY(-9px) scale(1.01, .99) rotate(-2deg); }
      76% { transform: translateY(3px) scale(1.04, .96) rotate(1deg); }
      100% { transform: translateY(0) scale(1) rotate(0); }
    }
    @keyframes chatty-tip-in {
      from { opacity: 0; transform: translateY(4px) scale(.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes chatty-blink {
      0%, 92%, 100% { transform: scaleY(1); }
      95%, 97% { transform: scaleY(.08); }
    }
    @keyframes chatty-wink {
      0%, 100% { transform: scaleY(1); }
      35%, 68% { transform: scaleY(.04); }
    }
    @keyframes chatty-tail {
      0%, 55%, 100% { transform: rotate(0deg); }
      65% { transform: rotate(-5deg); }
      75% { transform: rotate(3deg); }
      85% { transform: rotate(-2deg); }
    }
    @keyframes chatty-ear {
      0%, 86%, 100% { transform: rotate(0deg); }
      89% { transform: rotate(-7deg); }
      92% { transform: rotate(2deg); }
      95% { transform: rotate(0deg); }
    }
    @keyframes chatty-head {
      0%, 70%, 100% { transform: rotate(var(--chatty-head-tilt, 0deg)); }
      75% { transform: rotate(calc(var(--chatty-head-tilt, 0deg) - 2.2deg)); }
      81% { transform: rotate(calc(var(--chatty-head-tilt, 0deg) + 1.4deg)); }
      87% { transform: rotate(var(--chatty-head-tilt, 0deg)); }
    }
    @keyframes chatty-paw {
      0%, 82%, 100% { transform: translateY(0); }
      87% { transform: translateY(-2px); }
      92% { transform: translateY(0); }
    }
    @keyframes chatty-spin {
      0% { transform: rotate(0deg) scale(1); }
      40% { transform: rotate(190deg) scale(1.05); }
      100% { transform: rotate(360deg) scale(1); }
    }
    @keyframes chatty-heart {
      0% { opacity: 0; transform: translate(-50%, 4px) scale(.55) rotate(-12deg); }
      18% { opacity: 1; }
      100% { opacity: 0; transform: translate(calc(-50% + var(--chatty-heart-x, 0px)), -44px) scale(1.15) rotate(var(--chatty-heart-rot, 0deg)); }
    }
    @media (max-width: 760px) {
      .chatty { width: 68px; }
      .chatty-pet { width: 68px; }
      .chatty[data-pos="br"] { right: 10px; bottom: max(146px, 12dvh); }
      .chatty[data-pos="bl"] { left: 10px; bottom: max(146px, 12dvh); }
      .chatty[data-pos="rm"] { right: 10px; }
      .chatty[data-pos="lm"] { left: 10px; }
      .chatty-bubble { max-width: 208px; min-width: 152px; font-size: 12px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .chatty, .chatty-art, .chatty-iris, .chatty-bubble { transition: none; }
      .chatty-spot { transition: none; }
      .chatty.is-in .chatty-pet,
      .chatty.is-in .chatty-eye,
      .chatty.is-in .chatty-tail,
      .chatty.is-in .chatty-ear-left,
      .chatty.is-in .chatty-ear-right,
      .chatty.is-in .chatty-head,
      .chatty.is-in .chatty-paw-left,
      .chatty.is-in .chatty-paw-right,
      .chatty.is-in .chatty-pet.chatty-pounce,
      .chatty.is-in .chatty-pet.chatty-spin,
      .chatty.is-in.is-winking .chatty-eye-right,
      .chatty-heart { animation: none; }
      .chatty-heart { display: none; }
      .chatty-pet.chatty-pounce { animation: none; }
    }
  `;

  const ART = `
    <svg class="chatty-art" viewBox="0 0 220 240" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="chatty-fur" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#353344"/>
          <stop offset="45%" stop-color="#1b1b27"/>
          <stop offset="100%" stop-color="#09090e"/>
        </linearGradient>
        <linearGradient id="chatty-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#242331"/>
          <stop offset="100%" stop-color="#08080d"/>
        </linearGradient>
        <linearGradient id="chatty-pink" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ff9aaa"/>
          <stop offset="100%" stop-color="#c95770"/>
        </linearGradient>
        <radialGradient id="chatty-red-eye" cx="34%" cy="28%" r="78%">
          <stop offset="0%" stop-color="#ffabb0"/>
          <stop offset="38%" stop-color="#ff4055"/>
          <stop offset="100%" stop-color="#b70726"/>
        </radialGradient>
        <radialGradient id="chatty-yellow-eye" cx="34%" cy="28%" r="78%">
          <stop offset="0%" stop-color="#fffbd0"/>
          <stop offset="42%" stop-color="#ffd83f"/>
          <stop offset="100%" stop-color="#d88a00"/>
        </radialGradient>
      </defs>
      <path class="chatty-tail" d="M154 198c25 3 39-11 32-28-5-11-17-12-21-4" fill="none" stroke="#f4efe3" stroke-width="16" stroke-linecap="round"/>
      <path class="chatty-tail" d="M154 198c25 3 39-11 32-28-5-11-17-12-21-4" fill="none" stroke="#101018" stroke-width="12" stroke-linecap="round"/>
      <ellipse cx="110" cy="190" rx="45" ry="40" fill="url(#chatty-body)" stroke="#f4efe3" stroke-width="2.6"/>
      <ellipse class="chatty-paw chatty-paw-left" cx="92" cy="220" rx="20" ry="11" fill="#171722" stroke="#f4efe3" stroke-width="2.4"/>
      <ellipse class="chatty-paw chatty-paw-right" cx="128" cy="220" rx="20" ry="11" fill="#171722" stroke="#f4efe3" stroke-width="2.4"/>
      <g fill="none" stroke="#3d3b4c" stroke-width="2.5" stroke-linecap="round" opacity=".7">
        <path d="M84 218q6 5 12 0M104 222q6 5 12 0M118 218q6 5 12 0M138 222q6 5 12 0"/>
      </g>
      <g class="chatty-head">
      <g class="chatty-ear chatty-ear-left">
        <path d="M72 83 46 26l50 28z" fill="url(#chatty-fur)" stroke="#f4efe3" stroke-width="2.8" stroke-linejoin="round"/>
        <path d="M64 72 50 39l34 18z" fill="url(#chatty-pink)" opacity=".82"/>
      </g>
      <g class="chatty-ear chatty-ear-right">
        <path d="M148 83 174 26l-50 28z" fill="url(#chatty-fur)" stroke="#f4efe3" stroke-width="2.8" stroke-linejoin="round"/>
        <path d="M156 72 170 39l-34 18z" fill="url(#chatty-pink)" opacity=".82"/>
      </g>
      <path d="M110 56c-38 0-54 24-51 53 3 30 23 49 51 49s48-19 51-49c3-29-13-53-51-53z" fill="url(#chatty-fur)" stroke="#f4efe3" stroke-width="2.8" stroke-linejoin="round"/>
      <path d="M78 78c20-14 44-14 64 0-18 16-46 16-64 0z" fill="#444253" opacity=".24"/>
      <g class="chatty-eye">
        <path d="M63 104q17-17 37-3-7 20-27 19-10-1-10-16z" fill="#fff6e3"/>
        <path d="M63 104q17-17 37-3" fill="none" stroke="#09090f" stroke-width="5" stroke-linecap="round"/>
        <g class="chatty-iris" data-eye="left">
          <circle cx="82" cy="106" r="12" fill="url(#chatty-red-eye)" stroke="#190b10" stroke-width="2"/>
          <ellipse cx="82" cy="106" rx="4" ry="10" fill="#09090e"/>
          <circle cx="78" cy="101" r="3.5" fill="#fff" opacity=".95"/>
          <circle cx="86" cy="111" r="1.6" fill="#fff" opacity=".65"/>
        </g>
      </g>
      <g class="chatty-eye chatty-eye-right">
        <path d="M157 104q-17-17-37-3 7 20 27 19 10-1 10-16z" fill="#fff6e3"/>
        <path d="M157 104q-17-17-37-3" fill="none" stroke="#09090f" stroke-width="5" stroke-linecap="round"/>
        <g class="chatty-iris" data-eye="right">
          <circle cx="138" cy="106" r="12" fill="url(#chatty-yellow-eye)" stroke="#190b10" stroke-width="2"/>
          <ellipse cx="138" cy="106" rx="4" ry="10" fill="#09090e"/>
          <circle cx="134" cy="101" r="3.5" fill="#fff" opacity=".95"/>
          <circle cx="142" cy="111" r="1.6" fill="#fff" opacity=".65"/>
        </g>
      </g>
      <path d="M104 127q6-5 12 0-1 7-6 9-5-2-6-9z" fill="#ff7f91"/>
      <path d="M110 136c0 6-6 9-11 6M110 136c0 6 6 9 11 6" fill="none" stroke="#d2b8a4" stroke-width="2.5" stroke-linecap="round"/>
      <g fill="none" stroke="#fff2d9" stroke-width="2" stroke-linecap="round" opacity=".65">
        <path d="M64 127c-12-3-23-3-33 0"/>
        <path d="M64 136c-12-1-22 2-32 7"/>
        <path d="M156 127c12-3 23-3 33 0"/>
        <path d="M156 136c12-1 22 2 32 7"/>
      </g>
      <path d="M77 158c18 12 48 12 66 0" fill="none" stroke="#ef5265" stroke-width="8" stroke-linecap="round"/>
      <path d="M110 163l3.5 7 8 1-6 6 1.5 8-7-4-7 4 1.5-8-6-6 8-1z" fill="#ffd65c" stroke="#a96819" stroke-width="1.5" stroke-linejoin="round"/>
      </g>
    </svg>
  `;

  let enabled = readFlag(ENABLED_KEY, '1') !== '0';
  let rootNode = null;
  let petNode = null;
  let bubbleNode = null;
  let textNode = null;
  let labelNode = null;
  let actionsNode = null;
  let appearTimer = 0;
  let hideTimer = 0;
  let tipTimer = 0;
  let pounceTimer = 0;
  let spinTimer = 0;
  let winkTimer = 0;
  let wanderTimer = 0;
  let moveTimer = 0;
  let raf = 0;
  let lastTip = -1;
  let lastJoke = -1;
  let lastWasFunny = false;
  let lastWink = 0;
  let wanderCount = 0;
  let lastPosition = '';
  let pointer = null;
  let audioContext = null;
  let lastReadyChime = 0;
  let spotNode = null;
  let tourCursor = 0;
  let tourTarget = null;
  let tourStep = -1;
  let tourBusy = false;
  let tutorLesson = null;
  let tutorStep = -1;
  let lastLesson = -1;

  function readFlag(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function writeFlag(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* a private window may refuse storage; Chatty still works for this page */
    }
  }

  function unlockAudio() {
    if (audioContext) {
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      audioContext = new Ctx();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    } catch {
      audioContext = null;
    }
  }

  // One quiet note when a finished answer means the composer is ready again.
  function playReadyChime() {
    if (!audioContext) return;
    if (audioContext.state === 'suspended') {
      audioContext.resume().then(playReadyChime).catch(() => {});
      return;
    }
    if (audioContext.state !== 'running') return;
    const now = Date.now();
    if (now - lastReadyChime < 700) return;
    lastReadyChime = now;
    try {
      const start = audioContext.currentTime;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(523.25, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.018, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.23);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.25);
    } catch {
      /* Audio is optional; a device problem must not break a finished turn. */
    }
  }

  function isEnabled() {
    return enabled;
  }

  function isBlocked() {
    if (document.hidden) return true;
    return Boolean(document.querySelector('dialog[open], .overlay:not(.hidden)'));
  }

  function isEditable(node) {
    const element = node && node.nodeType === 1 ? node : node && node.parentElement;
    return Boolean(
      element &&
        typeof element.closest === 'function' &&
        element.closest('input, textarea, select, [contenteditable="true"]'),
    );
  }

  function tipContext() {
    if (typeof document === 'undefined') return '';
    const visible = (selector) => {
      const node = document.querySelector(selector);
      return Boolean(node) && !node.hidden && !node.classList.contains('hidden');
    };
    if (visible('#rail') && visible('#railSecrets')) return 'secrets';
    if (visible('#rail') && visible('#railPreview')) return 'preview';
    if (document.querySelector('#modeBuild')?.classList.contains('active')) return 'build';
    if (document.querySelector('#modePlan')?.classList.contains('active')) return 'plan';
    return '';
  }

  function pickWorkflowTip(context) {
    const tips = WORKFLOW_TIPS[context];
    if (!tips || !tips.length) return '';
    return tips[Math.floor(Math.random() * tips.length)];
  }

  function pickTip() {
    const context = tipContext();
    if (context && Math.random() < WORKFLOW_CHANCE) {
      const workflowTip = pickWorkflowTip(context);
      if (workflowTip) return workflowTip;
    }
    if (TIPS.length === 1) return TIPS[0];
    let index = Math.floor(Math.random() * TIPS.length);
    if (index === lastTip) index = (index + 1) % TIPS.length;
    lastTip = index;
    return TIPS[index];
  }

  function pickJoke() {
    if (JOKES.length === 1) return JOKES[0];
    let index = Math.floor(Math.random() * JOKES.length);
    if (index === lastJoke) index = (index + 1) % JOKES.length;
    lastJoke = index;
    return JOKES[index];
  }

  function pickMessage() {
    const funny = !lastWasFunny && Math.random() < FUNNY_CHANCE;
    lastWasFunny = funny;
    return funny ? pickJoke() : pickTip();
  }

  function clearTourPlacement() {
    if (!rootNode) return;
    rootNode.style.left = '';
    rootNode.style.right = '';
    rootNode.style.top = '';
    rootNode.style.bottom = '';
    delete rootNode.dataset.bubble;
    delete rootNode.dataset.bubbleSide;
  }

  function visibleTarget(target) {
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    if (rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) return false;
    const style = getComputedStyle(target);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function nextTourStop() {
    for (let i = 0; i < TOUR_STOPS.length; i += 1) {
      const stop = TOUR_STOPS[tourCursor % TOUR_STOPS.length];
      tourCursor += 1;
      for (const selector of stop.selectors) {
        const target = document.querySelector(selector);
        if (visibleTarget(target)) return { stop, target };
      }
    }
    return null;
  }

  function findTourTarget(start = 0) {
    for (let i = Math.max(0, start); i < TOUR_STOPS.length; i += 1) {
      const stop = TOUR_STOPS[i];
      for (const selector of stop.selectors) {
        const target = document.querySelector(selector);
        if (visibleTarget(target)) return { stop, target, index: i };
      }
    }
    return null;
  }

  function tourActions(index) {
    const last = index >= TOUR_STOPS.length - 1;
    return [
      { action: 'next', label: last ? 'Finish tour' : 'Next stop', primary: true },
      { action: 'skip', label: 'End tour' },
    ];
  }

  function placeNear(target) {
    const rect = target.getBoundingClientRect();
    const box = petNode.getBoundingClientRect();
    const width = box.width || 84;
    const height = box.height || width * 1.14;
    const gap = 10;
    const below = rect.bottom + gap;
    const above = rect.top - height - gap;
    const y = below + height <= innerHeight - 8 ? below : Math.max(8, above);
    const x = Math.max(8, Math.min(innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
    rootNode.dataset.pos = 'tour';
    rootNode.style.left = `${Math.round(x)}px`;
    rootNode.style.top = `${Math.round(y)}px`;
    rootNode.style.right = 'auto';
    rootNode.style.bottom = 'auto';
    rootNode.dataset.bubble = y > rect.bottom ? 'below' : 'above';
    rootNode.dataset.bubbleSide = x + width / 2 < innerWidth / 2 ? 'left' : 'right';
  }

  function showSpotlight(target) {
    if (!spotNode || !visibleTarget(target)) {
      hideSpotlight();
      return;
    }
    const rect = target.getBoundingClientRect();
    tourTarget = target;
    spotNode.style.left = `${Math.max(4, Math.round(rect.left - 4))}px`;
    spotNode.style.top = `${Math.max(4, Math.round(rect.top - 4))}px`;
    spotNode.style.width = `${Math.max(16, Math.round(rect.width + 8))}px`;
    spotNode.style.height = `${Math.max(16, Math.round(rect.height + 8))}px`;
    spotNode.hidden = false;
    spotNode.classList.add('is-on');
  }

  function hideSpotlight() {
    tourTarget = null;
    if (!spotNode) return;
    spotNode.classList.remove('is-on');
    spotNode.hidden = true;
  }

  function choosePosition() {
    clearTourPlacement();
    const options = POSITIONS.filter((position) => position !== lastPosition);
    lastPosition = options[Math.floor(Math.random() * options.length)] || 'br';
    rootNode.dataset.pos = lastPosition;
  }

  function resetLook() {
    if (!rootNode) return;
    clearTimeout(winkTimer);
    rootNode.classList.remove('is-winking');
    rootNode.style.setProperty('--chatty-tilt', '0deg');
    rootNode.style.setProperty('--chatty-head-tilt', '0deg');
    for (const iris of rootNode.querySelectorAll('.chatty-iris')) {
      iris.style.transform = 'translate(0, 0)';
    }
  }

  function maybeWink(dx, dy) {
    if (REDUCE_MOTION || !rootNode || rootNode.classList.contains('is-winking')) return;
    if (Math.abs(dx) > 0.8 || Math.abs(dy) > 0.8) return;
    const now = Date.now();
    if (now - lastWink < 8000) return;
    if (Math.random() > 0.012) return;
    lastWink = now;
    rootNode.classList.add('is-winking');
    clearTimeout(winkTimer);
    winkTimer = setTimeout(() => rootNode.classList.remove('is-winking'), 620);
  }

  function lookAt() {
    if (!pointer || !rootNode || rootNode.hidden || REDUCE_MOTION) return;
    const rect = petNode.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dx = Math.max(-1, Math.min(1, (pointer.x - (rect.left + rect.width / 2)) / (rect.width * 0.72)));
    const dy = Math.max(-1, Math.min(1, (pointer.y - (rect.top + rect.height / 2)) / (rect.height * 0.72)));
    rootNode.style.setProperty('--chatty-tilt', `${(dx * 1.1).toFixed(2)}deg`);
    rootNode.style.setProperty('--chatty-head-tilt', `${(dx * 4.6).toFixed(2)}deg`);
    for (const iris of rootNode.querySelectorAll('.chatty-iris')) {
      iris.style.transform = `translate(${(dx * 3).toFixed(2)}px, ${(dy * 1.8).toFixed(2)}px)`;
    }
    maybeWink(dx, dy);
  }

  function pouncePet() {
    if (!petNode || REDUCE_MOTION) return;
    petNode.classList.remove('chatty-pounce');
    void petNode.offsetWidth;
    petNode.classList.add('chatty-pounce');
    clearTimeout(pounceTimer);
    pounceTimer = setTimeout(() => petNode.classList.remove('chatty-pounce'), 680);
  }

  function renderActions(actions) {
    if (!actionsNode) return;
    actionsNode.replaceChildren();
    const list = Array.isArray(actions) ? actions : [];
    actionsNode.hidden = !list.length;
    for (const item of list) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chatty-action' + (item.primary ? ' primary' : '');
      button.dataset.chattyAction = item.action;
      button.textContent = item.label;
      actionsNode.append(button);
    }
  }

  function fitBubble() {
    if (!rootNode || !bubbleNode || bubbleNode.hidden) return;
    const margin = 8;
    const bubble = bubbleNode.getBoundingClientRect();
    const root = rootNode.getBoundingClientRect();
    const shift =
      bubble.top < margin
        ? margin - bubble.top
        : bubble.bottom > innerHeight - margin
          ? innerHeight - margin - bubble.bottom
          : 0;
    if (!shift) return;
    const top = root.top + shift;
    if (top < margin || top + root.height > innerHeight - margin) return;
    rootNode.style.top = `${Math.round(top)}px`;
    rootNode.style.bottom = 'auto';
  }

  function showTip(message, duration = 13000, actions = null, label = 'Chatty') {
    if (!bubbleNode) return;
    hideSpotlight();
    textNode.textContent = message;
    if (labelNode) labelNode.textContent = label;
    renderActions(actions);
    bubbleNode.hidden = false;
    requestAnimationFrame(fitBubble);
    setTimeout(fitBubble, 260);
    clearTimeout(tipTimer);
    if (duration > 0) tipTimer = setTimeout(hideTip, duration);
  }

  function hideTip() {
    clearTimeout(tipTimer);
    if (bubbleNode) bubbleNode.hidden = true;
    renderActions(null);
    hideSpotlight();
  }

  function openSettings() {
    if (!enabled) return;
    const trigger = document.querySelector('#settingsBtn');
    if (!trigger) {
      showTip(
        'I cannot find the Settings gear on this page, but the header gear is the one with the note.',
        9000,
        TUTOR_ACTIONS,
      );
      return;
    }
    hide(90000);
    trigger.click();
  }

  function showSettingsNotes() {
    if (!enabled) return;
    const panel = document.querySelector('#settingsDialog, #settingsOverlay .modal');
    if (!panel) return;
    const overlay = panel.closest('.overlay');
    const open =
      panel.tagName === 'DIALOG' ? panel.open : Boolean(overlay && !overlay.classList.contains('hidden'));
    if (!open) return;
    document.querySelectorAll('.chatty-settings-note').forEach((node) => node.remove());
    const cloud = panel.id === 'settingsDialog';
    const tips = cloud
      ? [
          { text: 'The provider key stays in this tab; use the key button, never chat.', focus: '#keyBtn' },
          { text: 'Workspace tools read and write browser files. Off means chat only.', focus: '#settingTools' },
          { text: 'Auto-approve skips only the write_file card; everything else still asks.', focus: '#settingAutoApprove' },
          { text: 'The Chatty switch hides me only; chats and keys stay exactly where they are.', focus: '#settingChatty' },
        ]
      : [
          { text: 'Keep the system prompt short: one sentence about tone or format is plenty.', focus: '#sPrompt' },
          { text: 'Temperature low is focused; high is loose. Leave it blank for the provider default.', focus: '#sTemp' },
          { text: 'Tools let me read the workspace and act in Build. Off means chat only.', focus: '#sTools' },
          { text: 'The workspace folder is the only place my file tools may touch.', focus: '#sWorkspace' },
          { text: 'Auto-approve skips Allow cards. Leave it off unless you can restore the folder.', focus: '#sAutoApprove' },
          { text: 'The Chatty switch hides me only; chats and settings stay put.', focus: '#sChatty' },
        ];
    let index = 0;
    const note = document.createElement('section');
    note.className = 'chatty-settings-note';
    note.setAttribute('role', 'note');
    note.setAttribute('aria-label', "Chatty's settings notes");
    const head = document.createElement('div');
    head.className = 'chatty-settings-note__head';
    const title = document.createElement('strong');
    title.textContent = "Chatty's settings notes";
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'chatty-settings-note__close';
    close.textContent = '×';
    close.title = "Hide Chatty's settings notes";
    close.setAttribute('aria-label', "Hide Chatty's settings notes");
    head.append(title, close);
    const text = document.createElement('p');
    text.className = 'chatty-settings-note__text';
    text.setAttribute('aria-live', 'polite');
    const actions = document.createElement('div');
    actions.className = 'chatty-settings-note__actions';
    const show = document.createElement('button');
    show.type = 'button';
    show.className = 'chatty-settings-note__button';
    show.textContent = 'Show me';
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'chatty-settings-note__button';
    next.textContent = 'Next tip';
    actions.append(show, next);
    note.append(head, text, actions);
    const render = () => {
      const tip = tips[index];
      text.textContent = tip.text;
      show.disabled = !tip.focus;
    };
    show.addEventListener('click', () => {
      const tip = tips[index];
      const target = tip.focus ? panel.querySelector(tip.focus) : null;
      if (!target) return;
      target.scrollIntoView({ block: 'center', behavior: REDUCE_MOTION ? 'auto' : 'smooth' });
      target.focus({ preventScroll: true });
    });
    next.addEventListener('click', () => {
      index = (index + 1) % tips.length;
      render();
    });
    close.addEventListener('click', () => note.remove());
    if (cloud) {
      const anchor = panel.querySelector('#settingsTitle') || panel.firstElementChild;
      if (!anchor) return;
      anchor.insertAdjacentElement('afterend', note);
    } else {
      const body = panel.querySelector('.body');
      if (!body) return;
      body.prepend(note);
    }
    render();
  }

  function armHide(delay) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, delay);
  }

  function scheduleWander(delay) {
    clearTimeout(wanderTimer);
    if (!enabled) return;
    wanderTimer = setTimeout(
      wander,
      delay || WANDER_MIN_MS + Math.random() * (WANDER_MAX_MS - WANDER_MIN_MS),
    );
  }

  function wander() {
    wanderTimer = 0;
    if (!enabled || !rootNode || rootNode.hidden || wanderCount >= TOUR_LIMIT) return;
    if (isBlocked()) {
      hide();
      return;
    }
    if (tutorStep >= 0) {
      scheduleWander(6000);
      return;
    }
    if (isEditable(document.activeElement)) {
      scheduleWander(6000);
      return;
    }
    if (bubbleNode && !bubbleNode.hidden) {
      scheduleWander(4000);
      return;
    }
    wanderCount += 1;
    const tour = nextTourStop();
    const message = tour ? tour.stop.tip : pickTip();
    const arrive = () => {
      moveTimer = 0;
      if (!enabled || !rootNode || rootNode.hidden) return;
      if (isBlocked()) {
        hide();
        return;
      }
      if (tour && visibleTarget(tour.target)) {
        placeNear(tour.target);
        showTip(message, 10000);
        showSpotlight(tour.target);
      } else {
        choosePosition();
        hideSpotlight();
        showTip(message);
      }
      rootNode.classList.remove('is-wandering');
      if (!REDUCE_MOTION) {
        petNode.classList.remove('chatty-pounce');
        void petNode.offsetWidth;
        petNode.classList.add('chatty-pounce');
        clearTimeout(pounceTimer);
        pounceTimer = setTimeout(() => petNode.classList.remove('chatty-pounce'), 680);
      }
      armHide(wanderCount < TOUR_LIMIT ? 30000 : 15000);
      if (wanderCount < TOUR_LIMIT) scheduleWander();
    };
    if (REDUCE_MOTION) {
      arrive();
      return;
    }
    hideTip();
    rootNode.classList.add('is-wandering');
    clearTimeout(moveTimer);
    moveTimer = setTimeout(arrive, 240);
  }

  function startTour() {
    if (!enabled || !rootNode || isBlocked()) return;
    clearTimeout(appearTimer);
    clearTimeout(hideTimer);
    clearTimeout(wanderTimer);
    clearTimeout(moveTimer);
    tutorStep = -1;
    tutorLesson = null;
    writeFlag(SEEN_KEY, '1');
    wanderCount = TOUR_LIMIT;
    tourStep = -1;
    tourBusy = false;
    if (rootNode.hidden) {
      choosePosition();
      rootNode.hidden = false;
      requestAnimationFrame(() => rootNode.classList.add('is-in'));
    }
    showTourStep(0);
  }

  function showTourStep(start) {
    if (!enabled || !rootNode || rootNode.hidden) return;
    const found = findTourTarget(start);
    if (!found) {
      finishTour();
      return;
    }
    tourStep = found.index;
    tourBusy = true;
    hideTip();
    clearTimeout(hideTimer);
    clearTimeout(wanderTimer);
    const arrive = () => {
      moveTimer = 0;
      if (!enabled || !rootNode || rootNode.hidden || tourStep !== found.index) return;
      if (!visibleTarget(found.target)) {
        tourBusy = false;
        rootNode.classList.remove('is-wandering');
        showTourStep(found.index + 1);
        return;
      }
      placeNear(found.target);
      showTip(
        found.stop.tip,
        0,
        tourActions(found.index),
        `Tour ${found.index + 1}/${TOUR_STOPS.length}`,
      );
      showSpotlight(found.target);
      rootNode.classList.remove('is-wandering');
      pouncePet();
      tourBusy = false;
      armHide(180000);
    };
    if (REDUCE_MOTION) {
      arrive();
      return;
    }
    rootNode.classList.add('is-wandering');
    clearTimeout(moveTimer);
    moveTimer = setTimeout(arrive, 240);
  }

  function advanceTour() {
    if (!enabled || tourStep < 0 || tourBusy) return;
    if (tourStep >= TOUR_STOPS.length - 1) {
      finishTour();
      return;
    }
    showTourStep(tourStep + 1);
  }

  function finishTour() {
    tourStep = -1;
    tourBusy = false;
    writeFlag(TOUR_KEY, '1');
    writeFlag(SEEN_KEY, '1');
    wanderCount = TOUR_LIMIT;
    hideSpotlight();
    showTip(
      "That's the tour! You know where everything lives now. Click me any time for a tip, a joke, a pounce, a Cat school lesson, or Settings.",
      16000,
      TUTOR_ACTIONS,
    );
    spawnHeart(3);
    armHide(28000);
  }

  function abandonTour() {
    tourStep = -1;
    tourBusy = false;
    writeFlag(TOUR_KEY, '1');
    writeFlag(SEEN_KEY, '1');
    if (labelNode) labelNode.textContent = 'Chatty';
    renderActions(null);
    hide(60000);
  }

  function pickLesson() {
    let index = Math.floor(Math.random() * LESSONS.length);
    if (index === lastLesson) index = (index + 1) % LESSONS.length;
    lastLesson = index;
    return LESSONS[index];
  }

  function makeVisible() {
    if (!rootNode) return;
    clearTimeout(appearTimer);
    if (rootNode.hidden) {
      choosePosition();
      rootNode.hidden = false;
    }
    requestAnimationFrame(() => rootNode.classList.add('is-in'));
  }

  function showTutorStep() {
    if (!enabled || !rootNode || !tutorLesson || tutorStep < 0 || isBlocked()) return;
    const step = tutorStep;
    if (step >= tutorLesson.steps.length) {
      finishTutor();
      return;
    }
    const last = step === tutorLesson.steps.length - 1;
    showTip(
      tutorLesson.steps[step],
      0,
      [
        { action: 'tutor-next', label: last ? 'Finish lesson' : 'Next paw', primary: true },
        { action: 'tutor-stop', label: 'Stop' },
      ],
      `Cat school ${step + 1}/${tutorLesson.steps.length}`,
    );
    armHide(180000);
  }

  function startTutor() {
    if (!enabled || !rootNode || isBlocked()) return;
    clearTimeout(appearTimer);
    clearTimeout(hideTimer);
    clearTimeout(wanderTimer);
    clearTimeout(moveTimer);
    if (tourStep >= 0 || tourBusy) {
      tourStep = -1;
      tourBusy = false;
      hideSpotlight();
      rootNode.classList.remove('is-wandering');
    }
    tutorLesson = pickLesson();
    tutorStep = 0;
    makeVisible();
    showTutorStep();
    pouncePet();
    spawnHeart(2);
  }

  function advanceTutor() {
    if (!enabled || !tutorLesson || tutorStep < 0) return;
    if (tutorStep >= tutorLesson.steps.length - 1) {
      finishTutor();
      return;
    }
    tutorStep += 1;
    showTutorStep();
  }

  function finishTutor() {
    if (!tutorLesson) {
      stopTutor();
      return;
    }
    const lesson = tutorLesson;
    tutorStep = -1;
    tutorLesson = null;
    showTip(
      lesson.finish,
      22000,
      [
        { action: 'tutor-another', label: 'Another lesson', primary: true },
        { action: 'later', label: 'Done' },
      ],
      'Cat school · done',
    );
    spawnHeart(3);
    armHide(32000);
  }

  function stopTutor() {
    tutorStep = -1;
    tutorLesson = null;
    if (labelNode) labelNode.textContent = 'Chatty';
    showTip(
      'Class dismissed. I will be in the corner, pretending not to knock something off the desk.',
      9000,
      TUTOR_ACTIONS,
    );
    armHide(16000);
  }

  function show() {
    if (!enabled || isBlocked()) {
      if (enabled) schedule(22000);
      return;
    }
    if (tourStep >= 0 || tutorStep >= 0) return;
    clearTimeout(appearTimer);
    if (!rootNode) return;
    if (rootNode.hidden) {
      wanderCount = 0;
      choosePosition();
      rootNode.hidden = false;
    }
    requestAnimationFrame(() => rootNode.classList.add('is-in'));
    armHide(26000);
    const tourDone = readFlag(TOUR_KEY, '') === '1';
    if (isEditable(document.activeElement)) {
      hideTip();
    } else if (!tourDone) {
      if (readFlag(SEEN_KEY, '') !== '1') {
        writeFlag(SEEN_KEY, '1');
        showTip(WELCOME, 24000, WELCOME_ACTIONS);
        armHide(36000);
      } else {
        showTip(TOUR_INVITE, 20000, WELCOME_ACTIONS);
        armHide(28000);
      }
    } else if (Math.random() < 0.58) {
      showTip(pickMessage(), 13000, TUTOR_ACTIONS);
    }
    if (tourDone) scheduleWander();
    if (pointer) lookAt();
  }

  function hide(cooldown = 42000 + Math.random() * 33000) {
    clearTimeout(appearTimer);
    clearTimeout(hideTimer);
    clearTimeout(tipTimer);
    clearTimeout(pounceTimer);
    clearTimeout(spinTimer);
    clearTimeout(winkTimer);
    clearTimeout(wanderTimer);
    clearTimeout(moveTimer);
    if (!rootNode) return;
    if (rootNode.contains(document.activeElement)) document.activeElement.blur();
    if (tourStep >= 0 || tourBusy) {
      tourStep = -1;
      tourBusy = false;
    }
    tutorStep = -1;
    tutorLesson = null;
    if (labelNode) labelNode.textContent = 'Chatty';
    renderActions(null);
    hideTip();
    petNode.classList.remove('chatty-spin', 'chatty-pounce');
    rootNode.classList.remove('is-winking', 'is-wandering');
    rootNode.querySelectorAll('.chatty-heart').forEach((heart) => heart.remove());
    rootNode.classList.remove('is-in');
    setTimeout(() => {
      if (rootNode && !rootNode.classList.contains('is-in')) rootNode.hidden = true;
    }, 240);
    resetLook();
    if (enabled) schedule(cooldown);
  }

  function dismiss() {
    if (!enabled) return;
    hide(DISMISS_MIN_MS + Math.random() * (DISMISS_MAX_MS - DISMISS_MIN_MS));
  }

  function schedule(delay) {
    clearTimeout(appearTimer);
    if (!enabled) return;
    appearTimer = setTimeout(() => {
      if (!enabled) return;
      if (isBlocked()) {
        schedule(22000);
        return;
      }
      show();
    }, Math.max(500, delay));
  }

  function spawnHeart(count = 1) {
    if (REDUCE_MOTION || !rootNode) return;
    for (let i = 0; i < count; i += 1) {
      const heart = document.createElement('span');
      heart.className = 'chatty-heart';
      heart.textContent = '♥';
      heart.setAttribute('aria-hidden', 'true');
      heart.style.setProperty('--chatty-heart-x', `${Math.round(Math.random() * 44 - 22)}px`);
      heart.style.setProperty('--chatty-heart-rot', `${Math.round(Math.random() * 30 - 15)}deg`);
      heart.style.animationDelay = `${i * 80}ms`;
      rootNode.append(heart);
      const remove = () => heart.remove();
      heart.addEventListener('animationend', remove, { once: true });
      setTimeout(remove, 1700 + i * 80);
    }
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    writeFlag(ENABLED_KEY, enabled ? '1' : '0');
    if (!rootNode) return;
    if (!enabled) {
      clearTimeout(appearTimer);
      clearTimeout(hideTimer);
      clearTimeout(pounceTimer);
      clearTimeout(spinTimer);
      clearTimeout(winkTimer);
      clearTimeout(wanderTimer);
      clearTimeout(moveTimer);
      tourStep = -1;
      tourBusy = false;
      tutorStep = -1;
      tutorLesson = null;
      renderActions(null);
      hideTip();
      document.querySelectorAll('.chatty-settings-note').forEach((node) => node.remove());
      petNode.classList.remove('chatty-spin', 'chatty-pounce');
      rootNode.classList.remove('is-winking', 'is-wandering');
      rootNode.querySelectorAll('.chatty-heart').forEach((heart) => heart.remove());
      rootNode.classList.remove('is-in');
      rootNode.hidden = true;
      resetLook();
      return;
    }
    schedule(1400);
  }

  function onCreate() {
    const style = document.createElement('style');
    style.id = 'chatty-style';
    style.textContent = STYLE;
    document.head.append(style);

    // Browsers only allow audio after a user gesture. Unlock once here so the
    // completion chime can play later, even if Chatty herself is switched off.
    document.addEventListener('pointerdown', unlockAudio, { passive: true, once: true });
    document.addEventListener('keydown', unlockAudio, { once: true });
    window.addEventListener('resize', () => {
      if (!tourTarget || !rootNode || rootNode.hidden || rootNode.dataset.pos !== 'tour') return;
      if (!visibleTarget(tourTarget)) {
        hideSpotlight();
        return;
      }
      placeNear(tourTarget);
      showSpotlight(tourTarget);
    });

    rootNode = document.createElement('aside');
    rootNode.id = 'chatty';
    rootNode.className = 'chatty';
    rootNode.dataset.pos = 'br';
    rootNode.hidden = true;
    rootNode.setAttribute('aria-label', 'Chatty');
    spotNode = document.createElement('div');
    spotNode.className = 'chatty-spot';
    spotNode.hidden = true;
    spotNode.setAttribute('aria-hidden', 'true');
    document.body.append(spotNode);

    rootNode.innerHTML = `
      <div class="chatty-bubble" role="status" aria-live="polite" title="Chatty tip. Click to continue, or use × to close." hidden>
        <button class="chatty-close" type="button" aria-label="Close tip and hide Chatty for a while" title="Close tip and hide Chatty for a while">×</button>
        <span class="chatty-label">Chatty</span>
        <span class="chatty-text"></span>
        <div class="chatty-actions" role="group" aria-label="Chatty actions" hidden></div>
      </div>
      <button class="chatty-pet" type="button" tabindex="-1" aria-label="Chatty the Freeway cat. Click to pounce and get a tip; double-click for a trick.">
        ${ART}
      </button>
    `;
    document.body.append(rootNode);

    petNode = rootNode.querySelector('.chatty-pet');
    bubbleNode = rootNode.querySelector('.chatty-bubble');
    textNode = rootNode.querySelector('.chatty-text');
    labelNode = rootNode.querySelector('.chatty-label');
    actionsNode = rootNode.querySelector('.chatty-actions');
    rootNode.querySelector('.chatty-close').addEventListener('click', (event) => {
      event.stopPropagation();
      dismiss();
    });
    actionsNode.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-chatty-action]');
      if (!button) return;
      event.stopPropagation();
      const action = button.dataset.chattyAction;
      if (action === 'settings') openSettings();
      else if (action === 'tutor') startTutor();
      else if (action === 'tutor-next') advanceTutor();
      else if (action === 'tutor-another') startTutor();
      else if (action === 'tutor-stop') stopTutor();
      else if (action === 'tour') startTour();
      else if (action === 'next') advanceTour();
      else if (action === 'skip') abandonTour();
      else if (action === 'later') dismiss();
    });
    bubbleNode.addEventListener('click', (event) => {
      if (!enabled) return;
      event.stopPropagation();
      if (tourStep >= 0) {
        advanceTour();
        return;
      }
      if (tutorStep >= 0) {
        advanceTutor();
        return;
      }
      dismiss();
    });
    petNode.addEventListener('click', (event) => {
      if (!enabled || event.detail > 1) return;
      if (tourStep >= 0) {
        advanceTour();
        return;
      }
      if (tutorStep >= 0) {
        if (bubbleNode.hidden) showTutorStep();
        else advanceTutor();
        pouncePet();
        spawnHeart();
        armHide(26000);
        return;
      }
      if (bubbleNode.hidden) {
        if (readFlag(TOUR_KEY, '') === '1') showTip(pickMessage(), 13000, TUTOR_ACTIONS);
        else showTip(WELCOME, 24000, WELCOME_ACTIONS);
      } else hideTip();
      pouncePet();
      spawnHeart();
      armHide(26000);
      if (readFlag(TOUR_KEY, '') === '1') scheduleWander();
    });
    petNode.addEventListener('dblclick', (event) => {
      event.preventDefault();
      if (!enabled || REDUCE_MOTION || tourStep >= 0) return;
      petNode.classList.remove('chatty-spin');
      void petNode.offsetWidth;
      petNode.classList.add('chatty-spin');
      clearTimeout(spinTimer);
      spinTimer = setTimeout(() => petNode.classList.remove('chatty-spin'), 900);
      spawnHeart(3);
      showTip('Wheee! That was my whole trick. I hope it was worth it.');
      armHide(26000);
      if (readFlag(TOUR_KEY, '') === '1') scheduleWander();
    });

    document.addEventListener(
      'pointermove',
      (event) => {
        pointer = { x: event.clientX, y: event.clientY };
        if (!rootNode || rootNode.hidden || raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          lookAt();
        });
      },
      { passive: true },
    );
    document.addEventListener('mouseout', (event) => {
      if (!event.relatedTarget) {
        pointer = null;
        resetLook();
      }
    });
    window.addEventListener('blur', resetLook);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) hide();
      else if (enabled) schedule(5000);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && bubbleNode && !bubbleNode.hidden) {
        dismiss();
      }
    });
    document.addEventListener(
      'click',
      (event) => {
        if (!(event.target instanceof Element)) return;
        if (!event.target.closest('#settingsBtn')) return;
        setTimeout(() => {
          if (enabled) showSettingsNotes();
        }, 0);
      },
      true,
    );
    document.addEventListener(
      'click',
      (event) => {
        if (rootNode.contains(event.target)) return;
        setTimeout(() => {
          if (isBlocked()) hide();
        }, 0);
      },
      true,
    );
    document.addEventListener('focusin', (event) => {
      if (!isEditable(event.target)) return;
      if (tourStep >= 0) {
        abandonTour();
        return;
      }
      hideTip();
    });
    document.addEventListener(
      'wheel',
      () => {
        if (tourStep < 0 && bubbleNode && !bubbleNode.hidden) hideTip();
      },
      { passive: true },
    );
    document.addEventListener(
      'touchmove',
      () => {
        if (tourStep < 0 && bubbleNode && !bubbleNode.hidden) hideTip();
      },
      { passive: true },
    );
    window.addEventListener('storage', (event) => {
      if (event.key !== ENABLED_KEY) return;
      enabled = readFlag(ENABLED_KEY, '1') !== '0';
      if (enabled) schedule(1200);
      else {
        clearTimeout(appearTimer);
        clearTimeout(wanderTimer);
        clearTimeout(moveTimer);
        tourStep = -1;
        tourBusy = false;
        tutorStep = -1;
        tutorLesson = null;
        renderActions(null);
        hideTip();
        document.querySelectorAll('.chatty-settings-note').forEach((node) => node.remove());
        rootNode.classList.remove('is-in', 'is-wandering');
        rootNode.hidden = true;
      }
    });

    if (enabled) schedule(5200 + Math.random() * 2800);
  }

  const api = {
    isEnabled,
    setEnabled,
    show: () => show(),
    hide,
    tutor: () => startTutor(),
    settings: () => openSettings(),
    ready: playReadyChime,
    tip: (message) => {
      if (!enabled) return;
      if (!rootNode || rootNode.hidden) show();
      showTip(message || pickMessage());
    },
  };
  window.FreewayChatty = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onCreate, { once: true });
  } else {
    onCreate();
  }
})(typeof window !== 'undefined' ? window : globalThis);
