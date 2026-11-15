/* Chatty — Freeway's tiny corner companion.
 *
 * One runtime for the desktop and cloud pages. It owns its styles and DOM so
 * both editions stay identical, and it only ever reads/writes the local
 * Chatty preference. It never touches chats, keys or provider requests.
 */
(function (root) {
  'use strict';

  const ENABLED_KEY = 'freeway.chatty.enabled';
  const TOUR_KEY = 'freeway.chatty.tour.v2';
  const POSITIONS = ['br', 'bl', 'rm', 'lm'];
  const DISMISS_MIN_MS = 2 * 60 * 1000;
  const DISMISS_MAX_MS = 3.5 * 60 * 1000;
  const WANDER_MIN_MS = 12 * 1000;
  const WANDER_MAX_MS = 17 * 1000;
  const TOUR_LIMIT = 2;
  const PLAY_MIN_MS = 26 * 1000;
  const PLAY_MAX_MS = 44 * 1000;
  const IDLE_MIN_MS = 12 * 1000;
  const WELCOME =
    "Psst! I'm Chatty, the Freeway cat. Click me to see me pounce, let me tutor you in Cat school, or open Settings and I'll leave a note. Short lessons, bad puns, no hairballs.";
  const SETTINGS_ACTION = { action: 'settings', label: 'Settings' };
  const TUTOR_ACTIONS = [
    { action: 'tutor', label: 'Tutor me' },
    { action: 'tour', label: 'Tour' },
    SETTINGS_ACTION,
  ];
  const WELCOME_ACTIONS = [
    { action: 'tutor', label: 'Tutor me', primary: true },
    SETTINGS_ACTION,
    { action: 'tour', label: 'Tour' },
    { action: 'later', label: 'Later' },
  ];
  const PLAN_ACTIONS = [
    { action: 'build', label: 'Switch to Build', primary: true },
    { action: 'later', label: 'Not yet' },
  ];
  const PROMPT_LESSON = 'The Three-Paw Prompt';
  const PROMPT_ACTIONS = [
    { action: 'prompt-lesson', label: 'Prompt lesson', primary: true },
    { action: 'later', label: 'Not now' },
  ];
  const PROMPT_COACH_GAP = 10 * 60 * 1000;
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
      'Keep keys in Settings → Secrets, never in chat. They stay out of the transcript and workspace.',
      'Settings → Secrets lists names and hints, not your key values.',
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
        'Keys go in Settings → Secrets, not chat. Chat is a window; the secret store is the locked cupboard.',
        'Never paste a key into a prompt or a file. If it leaks, revoke it at the provider and make a new one.',
        'A .env file is still a file. Settings → Secrets keeps me from pretending I have thumbs.',
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
      selectors: ['#sideBtn'],
      tip: 'Control board tour: I will walk every button in reading order. Chats opens your saved conversations; search them, then pick up any thread where you left off.',
    },
    {
      selectors: ['#newChatBtn', '#clearBtn'],
      tip: 'New starts a clean chat. Saved conversations stay under Chats; a fresh start never deletes them.',
    },
    {
      selectors: ['#provider'],
      tip: 'Provider chooses who answers. OVHcloud needs no key; the other providers use a key from Key. Free models stay free on every provider.',
    },
    {
      selectors: ['#modelBtn'],
      tip: 'Model opens the free model list. Each entry shows its context and strengths; Ctrl + M opens it too. Everything in this list is free.',
    },
    {
      selectors: ['#quota', '#keyBtn'],
      tip: 'Quota shows today’s free usage. Key opens provider keys and limits. Keys stay in this app or browser and are never put in the chat.',
    },
    {
      selectors: ['#settingsBtn'],
      tip: 'Settings holds keys, workspace, tools, approvals and my own switch. Open it and I will leave notes beside the important sections.',
    },
    {
      selectors: ['#quickPreview'],
      tip: 'Preview opens the working preview of what we built. It only shows the result; Build is what changes files.',
    },
    {
      selectors: ['#railBtn'],
      tip: 'Files opens the workspace and GitHub, and Health shows provider status. This is where I read files and where you inspect changes.',
    },
    {
      selectors: ['#quitBtn'],
      tip: 'Quit stops this desktop app or cloud tab after saving your chats. Close it when you want the server off; reopening brings the chats back.',
    },
    {
      selectors: ['#modePlan'],
      tip: 'Plan is read-only: I inspect files and write a route, but cannot change or run anything. Start here when the work is risky.',
    },
    {
      selectors: ['#modeBuild'],
      tip: 'Build lets me edit files and run commands. Every write or command still needs an Allow card first, so nothing changes silently.',
    },
    {
      selectors: ['#input'],
      tip: 'The composer is your message. Enter sends and Shift + Enter adds a line. The conversation and my answer appear above it.',
    },
    {
      selectors: ['#suggest'],
      tip: 'These starters fill the composer with a useful request. Pick one, edit it to fit, then press Send.',
    },
    {
      selectors: ['#imageLabel'],
      tip: 'Image attaches a PNG, JPEG or WebP picture. I can inspect it with the message; it stays attached to this chat.',
    },
    {
      selectors: ['#attachLabel'],
      tip: 'Attach reads a text file into this message. For files already in the workspace, use Files in the rail instead.',
    },
    {
      selectors: ['#memoryBtn'],
      tip: 'Memory edits the note I carry into every turn of this chat: your tone, rules and facts to remember.',
    },
    {
      selectors: ['#sendBtn', '#send'],
      tip: 'Send posts the message and attachments. Enter in the composer does the same, and the answer streams above.',
    },
    {
      selectors: ['#stopBtn', '#stop'],
      tip: 'Stop cancels the answer while it is streaming. It is disabled when nothing is running, so it cannot interrupt an idle chat.',
    },
  ];
  // A tip that names a control should point at it. The patterns are narrow on
  // purpose: "Build still asks before it writes" must move the cat to the Build
  // button, but a passing mention of a file should not drag her across the page.
  const MESSAGE_TARGETS = [
    { pattern: /\bswitch to build\b|\bbuild mode\b|\bbuild button\b|\bpress build\b|\bclick build\b/i, selectors: ['#modeBuild'] },
    { pattern: /\bplan mode\b|\bplan\b[^.\n]{0,24}read-only|\bswitch to plan\b/i, selectors: ['#modePlan'] },
    { pattern: /\bsettings\b/i, selectors: ['#settingsBtn'] },
    { pattern: /\bmodel (picker|chip|menu|list)\b|ctrl \+ m/i, selectors: ['#modelBtn', '#modelPicker'] },
    { pattern: /\bnew chat\b|\bclean slate\b|alt \+ n/i, selectors: ['#clearBtn', '#newChatBtn', '#newBtn'] },
    { pattern: /\bcommand palette\b|ctrl \+ k/i, selectors: ['#paletteBtn'] },
    { pattern: /\bsaved chats?\b|alt \+ h/i, selectors: ['#historyBtn'] },
    { pattern: /\bcomposer\b/i, selectors: ['#input'] },
    { pattern: /\bimage\b|\.png\b|\bjpeg\b/i, selectors: ['#imageLabel'] },
    { pattern: /\battach\b|\battachment\b/i, selectors: ['#attachLabel'] },
    { pattern: /\bmemory\b/i, selectors: ['#memoryBtn'] },
    { pattern: /\bpress send\b|\bsend button\b|\bhit send\b/i, selectors: ['#sendBtn', '#send'] },
    { pattern: /\bpreview\b/i, selectors: ['#quickPreview'] },
    { pattern: /\bfiles rail\b|\bthe files\b|\bhealth\b/i, selectors: ['#railBtn'] },
    { pattern: /\b429\b|retry-after|next send/i, selectors: ['#nextSend'] },
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
      /* Travel is a Web Animations glide. Position changes themselves must snap
         under the visual transform, or a late left/top transition can replay
         the trip after the cat has already landed. */
      transition:
        opacity .22s ease,
        transform .28s cubic-bezier(.2,.8,.2,1),
        translate .32s ease;
      pointer-events: none;
    }
    .chatty[hidden] { display: none; }
    .chatty.is-in { opacity: 1; transform: translate(0, 0) scale(1); }
    .chatty.is-in.is-wandering {
      opacity: .12;
      transform: translateY(8px) scale(.92);
    }
    .chatty.is-in.is-wandering .chatty-pet { pointer-events: none; }
    .chatty.is-in.is-touring { opacity: 1; transform: none; }
    .chatty.is-in.is-touring .chatty-pet,
    .chatty.is-in.is-touring .chatty-pet.chatty-pounce {
      animation: chatty-walk var(--chatty-move-ms, 900ms) ease-in-out;
    }
    .chatty-spot {
      position: fixed;
      z-index: 2147482999;
      pointer-events: none;
      border: 2px solid var(--accent, #f0f0f0);
      border-radius: 12px;
      box-shadow: 0 0 0 3px rgba(255, 255, 255, .10), 0 0 22px rgba(255, 255, 255, .22);
      opacity: 0;
      transition:
        opacity .18s ease,
        /* Match the cat's glide easing exactly; a faster-out ring reads as a
           second teleport even when both tweens share a duration. */
        left var(--chatty-spot-ms, 420ms) cubic-bezier(.4,0,.2,1),
        top var(--chatty-spot-ms, 420ms) cubic-bezier(.4,0,.2,1),
        width var(--chatty-spot-ms, 420ms) cubic-bezier(.4,0,.2,1),
        height var(--chatty-spot-ms, 420ms) cubic-bezier(.4,0,.2,1);
    }
    .chatty-spot.is-on { opacity: .95; }
    .chatty-spot[hidden] { display: none; }
    .chatty[data-pos="br"], .chatty[data-pos="rm"] { --chatty-enter: translate(14px, 8px); --chatty-shy-x: 18px; }
    .chatty[data-pos="bl"], .chatty[data-pos="lm"] { --chatty-enter: translate(-14px, 8px); --chatty-shy-x: -18px; }
    .chatty[data-pos="br"] { right: 16px; bottom: max(170px, 14dvh, var(--chatty-clearance, 0px)); }
    .chatty[data-pos="bl"] { left: 16px; bottom: max(170px, 14dvh, var(--chatty-clearance, 0px)); }
    .chatty[data-pos="rm"] { right: 16px; top: 46%; }
    .chatty[data-pos="lm"] { left: 16px; top: 46%; }
    .chatty-ball {
      position: absolute;
      right: -18px;
      bottom: 22px;
      width: 28px;
      height: 28px;
      z-index: 2;
      opacity: 0;
      pointer-events: none;
      filter: drop-shadow(0 4px 7px rgba(0, 0, 0, .28));
    }
    .chatty-ball[hidden] { display: none; }
    .chatty[data-pos="br"] .chatty-ball,
    .chatty[data-pos="rm"] .chatty-ball { right: auto; left: -22px; }
    .chatty[data-pos="bl"] .chatty-ball,
    .chatty[data-pos="lm"] .chatty-ball { left: auto; right: -22px; }
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
    .chatty.is-playing { animation: chatty-peek 3.2s ease-in-out; }
    .chatty.is-playing .chatty-ball {
      opacity: 1;
      animation: chatty-ball-bounce 3.1s cubic-bezier(.2,.8,.2,1);
    }
    .chatty.is-playing .chatty-head { animation: chatty-watch-ball 3.2s ease-in-out; }
    .chatty.is-playing .chatty-paw-right { animation: chatty-bat .52s ease-in-out 4; }
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
      /* Set by fitBubble when a phone is narrower than the cat's anchor. */
      translate: var(--chatty-bubble-shift, 0px) 0;
      /* A very short phone has no room for a full tip above or below the
         composer. Keep the bubble on screen and let its text scroll. */
      max-height: var(--chatty-bubble-max, none);
      overflow-y: auto;
      overscroll-behavior: contain;
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
    @keyframes chatty-walk {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      22% { transform: translateY(-1px) rotate(-2.4deg); }
      48% { transform: translateY(1px) rotate(1.8deg); }
      74% { transform: translateY(-1px) rotate(-1.1deg); }
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
    @keyframes chatty-ball-bounce {
      0% { opacity: 0; transform: translate(0, 2px) rotate(0deg) scale(.55); }
      12% { opacity: 1; transform: translate(2px, -8px) rotate(40deg) scale(1); }
      30% { transform: translate(11px, -24px) rotate(120deg) scale(1.02); }
      48% { transform: translate(-3px, 1px) rotate(200deg) scale(.98); }
      66% { transform: translate(12px, -16px) rotate(300deg) scale(1); }
      84% { opacity: .9; transform: translate(3px, -5px) rotate(390deg) scale(.92); }
      100% { opacity: 0; transform: translate(-8px, 6px) rotate(460deg) scale(.7); }
    }
    @keyframes chatty-peek {
      0%, 28%, 100% { translate: 0 0; opacity: 1; }
      44%, 74% { translate: var(--chatty-shy-x, 18px) 0; opacity: .86; }
    }
    @keyframes chatty-watch-ball {
      0%, 100% { transform: rotate(var(--chatty-head-tilt, 0deg)); }
      20% { transform: rotate(calc(var(--chatty-head-tilt, 0deg) - 6deg)); }
      45% { transform: rotate(calc(var(--chatty-head-tilt, 0deg) + 5deg)); }
      70% { transform: rotate(calc(var(--chatty-head-tilt, 0deg) - 3deg)); }
    }
    @keyframes chatty-bat {
      0%, 100% { transform: translate(0, 0) rotate(0deg); }
      40% { transform: translate(-4px, -5px) rotate(-10deg); }
      65% { transform: translate(2px, -2px) rotate(4deg); }
    }
    @media (max-width: 760px) {
      .chatty { width: 68px; }
      .chatty-pet { width: 68px; }
      .chatty[data-pos="br"] { right: 10px; bottom: max(146px, 12dvh, var(--chatty-clearance, 0px)); }
      .chatty[data-pos="bl"] { left: 10px; bottom: max(146px, 12dvh, var(--chatty-clearance, 0px)); }
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
      .chatty.is-playing,
      .chatty.is-playing .chatty-head,
      .chatty.is-playing .chatty-paw-right,
      .chatty.is-playing .chatty-ball,
      .chatty-heart { animation: none; }
      .chatty.is-playing { translate: 0 0; opacity: 1; }
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
  let glideAnimation = null;
  let raf = 0;
  let enterRaf = 0;
  let lastTip = -1;
  let lastJoke = -1;
  let lastWasFunny = false;
  let lastWink = 0;
  let wanderCount = 0;
  let lastPosition = '';
  let pointer = null;
  let audioContext = null;
  let lastReadyChime = 0;
  let lastActivity = Date.now();
  // Real input, not the app focusing the composer while it boots.
  let hasUserActed = false;
  let spotNode = null;
  let tourCursor = 0;
  let tourTarget = null;
  let tourStep = -1;
  let tourBusy = false;
  let tutorLesson = null;
  let tutorStep = -1;
  let lastLesson = -1;
  let lastPromptKey = '';
  let lastPromptCoachAt = 0;
  let ballNode = null;
  let playTimer = 0;
  let playEndTimer = 0;
  let ballPlaying = false;

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

  function noteActivity() {
    lastActivity = Date.now();
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

  function promptKey(text, source) {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = (hash * 31 + text.charCodeAt(i)) | 0;
    }
    return `${source}:${text.length}:${hash}`;
  }

  // Read only the local composer and the rendered user bubble. Prompt text is
  // never sent anywhere; the coach just names the piece that is missing.
  function readPromptSnapshot() {
    if (typeof document === 'undefined') return null;
    if (document.querySelector('#stopBtn:not([disabled]), #stop:not([disabled])')) return null;
    const input = document.querySelector('#input');
    const draft = input && typeof input.value === 'string' ? input.value.trim() : '';
    let latest = '';
    const bubbles = document.querySelectorAll('.msg.user .bubble');
    if (bubbles.length) latest = (bubbles[bubbles.length - 1].textContent || '').trim();
    const source = draft ? 'draft' : latest ? 'last' : '';
    if (!source) return null;
    const text = (draft || latest).slice(0, 8000);
    return text ? { text, source, key: promptKey(text, source) } : null;
  }

  function promptCoach(force = false) {
    const snapshot = readPromptSnapshot();
    if (!snapshot) return null;
    const now = Date.now();
    if (!force && snapshot.key === lastPromptKey && now - lastPromptCoachAt < PROMPT_COACH_GAP) {
      return null;
    }
    const { text, source, key } = snapshot;
    const words = text.split(/\s+/).filter(Boolean).length;
    const lead = source === 'draft' ? 'That draft' : 'That last prompt';
    const reply = (message) => {
      lastPromptKey = key;
      lastPromptCoachAt = now;
      return { message, label: 'Prompt coach', actions: PROMPT_ACTIONS };
    };

    if (
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text) ||
      /\b(?:sk-[A-Za-z0-9_-]{16,}|gsk_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/.test(text) ||
      /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*['\"]?[A-Za-z0-9_./+=-]{12,}/i.test(text)
    ) {
      return reply('Whoa — that looks like a credential. Take it out before sending and keep it in Settings → Secrets; I will not repeat it.');
    }

    if (/^(?:yes|no|ok|okay|sure|go|go ahead|do it|continue|try again|thanks|thank you|please|yep|nope|perfect|great)[.!?\s]*$/i.test(text)) {
      return null;
    }

    if (
      words <= 4 ||
      /^(?:fix|fix this|fix it|help|help me|do it|make it better|change it|update it|try again|what now|not working|broken|look at this|check this|review this|improve this|continue)\b/i.test(text)
    ) {
      return reply(`${lead} is a whisker short. Give me the goal, one clue from the code, and the check that proves it. Try: "In <file>, <goal>. Keep <constraint>. Verify with <check>."`);
    }

    const hasGoal = /\b(?:add|build|fix|change|update|remove|make|write|create|implement|explain|review|debug|test|refactor|improve|find|check|rename|move|delete|convert|show|tell|compare|summarize|design|investigate|why|how|help|mean)\b/i.test(text);
    const hasContext = /```|`[^`]+`|\.(?:js|mjs|cjs|ts|tsx|jsx|html|css|json|md|py|rb|go|rs|java|sh|yml|yaml|toml|lock)\b|\b(?:error|exception|traceback|stack|line \d+|http \d{3}|console|terminal|log|repro|screenshot)\b|(?:^|\s)(?:\/|\.{1,2}\/)[^\s]+/i.test(text);
    const hasConstraint = /\b(?:keep|without|don't|do not|only|must|should|avoid|no new|preserve|limit|at most|and nothing else)\b/i.test(text);
    const hasProof = /\b(?:test|tests|check|verify|run|pass|fail|works?|expected|actual|screenshot|result|reproduce|confirm|prove)\b/i.test(text);
    const hasFormat = /\b(?:table|list|json|markdown|diff|patch|steps|summary|bullet|code block|schema|one paragraph|short answer)\b/i.test(text);

    if ((words > 260 || text.length > 1800) && !hasFormat) {
      return reply(`${lead} is a lot at once. Put the goal on the first line, the clues next, and the proof last. One screen is easier to chase than twenty.`);
    }
    if (!hasGoal) {
      return reply(`${lead} has the detail but not the finish line. Start with the outcome: "Fix X so Y" or "Add X to Y".`);
    }
    if (!hasContext) {
      return reply(`${lead} names the outcome. Add one concrete clue — the file, the error, or what you see — so I do not guess.`);
    }
    if (!hasProof) {
      return reply(`${lead} says what to change but not how to prove it. Add: "Run <check> and show me the result."`);
    }
    if (!hasConstraint) {
      return reply(`${lead} has the goal, the clue and a check. Add one constraint — what must stay unchanged — and it is a three-paw prompt.`);
    }
    return reply(`${lead} has good bones: goal, constraints and a check. Keep the next one just as focused.`);
  }

  function showPromptCoach(force = false) {
    if (!enabled || !rootNode || isBlocked()) return false;
    if (tourStep >= 0 || tutorStep >= 0) return false;
    const tip = promptCoach(force);
    if (!tip) return false;
    clearTimeout(appearTimer);
    fitToComposer();
    if (rootNode.hidden) {
      wanderCount = 0;
      choosePosition();
      rootNode.hidden = false;
    }
    enterSoon();
    showTip(tip.message, 17000, tip.actions, tip.label);
    armHide(32000);
    pouncePet();
    return true;
  }

  function tipContext() {
    if (typeof document === 'undefined') return '';
    const visible = (selector) => {
      const node = document.querySelector(selector);
      return Boolean(node) && !node.hidden && !node.classList.contains('hidden');
    };
    if (
      document.querySelector('#settingsDialog[open], #settingsOverlay:not(.hidden)') &&
      visible('#settingsSecrets')
    ) {
      return 'secrets';
    }
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

  function renderedTarget(target) {
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const style = getComputedStyle(target);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function onScreen(target) {
    if (!renderedTarget(target)) return false;
    const rect = target.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  }

  // The first selector in the list that exists and is on screen wins; the two
  // editions name some controls differently, so a miss falls through.
  function targetForMessage(message) {
    const text = String(message || '');
    for (const entry of MESSAGE_TARGETS) {
      if (!entry.pattern.test(text)) continue;
      for (const selector of entry.selectors) {
        const node = document.querySelector(selector);
        if (node && visibleTarget(node)) return node;
      }
    }
    return null;
  }

  function visibleTarget(target) {
    return renderedTarget(target) && onScreen(target);
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

  function findTourTarget(start = 0, includeOffscreen = false) {
    for (let i = Math.max(0, start); i < TOUR_STOPS.length; i += 1) {
      const stop = TOUR_STOPS[i];
      for (const selector of stop.selectors) {
        const target = document.querySelector(selector);
        if (!renderedTarget(target)) continue;
        if (!includeOffscreen && !onScreen(target)) continue;
        return { stop, target, index: i };
      }
    }
    return null;
  }

  function tourActions(index) {
    // On a phone the last visible control can be Send: Stop and Quit are
    // hidden by their pages. Do not promise another stop when the next
    // selector does not exist on this viewport.
    const last = !findTourTarget(index + 1, true);
    return [
      { action: 'next', label: last ? 'Finish tour' : 'Next stop', primary: true },
      { action: 'skip', label: 'End tour' },
    ];
  }

  // Measure the real tip before she moves. The old fixed 220px reservation
  // was both too small for a phone composer and too large for the header on a
  // short landscape screen, so the bubble could overlap the target or be
  // shoved back on screen after landing.
  function measureBubble(message, actions, label) {
    if (!bubbleNode || !textNode) return 0;
    const wasHidden = bubbleNode.hidden;
    const visibility = bubbleNode.style.visibility;
    bubbleNode.style.setProperty('--chatty-bubble-shift', '0px');
    bubbleNode.style.removeProperty('--chatty-bubble-max');
    textNode.textContent = message;
    if (labelNode) labelNode.textContent = label;
    renderActions(actions);
    bubbleNode.style.visibility = 'hidden';
    bubbleNode.hidden = false;
    const height = bubbleNode.offsetHeight;
    bubbleNode.hidden = wasHidden;
    bubbleNode.style.visibility = visibility;
    return height;
  }

  function placeNear(target, measuredBubbleHeight = 0) {
    const rect = target.getBoundingClientRect();
    const box = petNode.getBoundingClientRect();
    const width = box.width || 84;
    const height = box.height || width * 1.14;
    const gap = 10;
    // The tip is part of the cat's footprint. If it is already visible, keep
    // the whole bubble clear of the target instead of letting fitBubble slide
    // the cat back over the control on a short phone screen. The tour measures
    // its next tip before travelling so it can reserve the real height.
    if (bubbleNode) bubbleNode.style.removeProperty('--chatty-bubble-max');
    let bubbleHeight =
      measuredBubbleHeight > 0
        ? measuredBubbleHeight
        : bubbleNode && !bubbleNode.hidden
          ? bubbleNode.offsetHeight
          : 220;
    const bubbleGap = bubbleHeight ? gap : 0;
    let below = rect.bottom + gap;
    const above = rect.top - height - gap;
    // A target in the header would otherwise park the cat on the pickers row
    // right beneath it, hiding the very control she is describing. Do this
    // before checking the fit: a below fit measured above the header is not a
    // fit once the cat is pushed down below it.
    const header = document.querySelector('header');
    const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
    if (rect.top < headerBottom - 1) below = Math.max(below, headerBottom + gap);
    let belowFits = below + height + bubbleHeight + bubbleGap <= innerHeight - 8;
    let aboveFits = above - bubbleHeight - bubbleGap >= 8;
    let bubblePosition;
    let forcedBubbleSide = '';
    let y;
    let x = Math.max(8, Math.min(innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
    // The bubble is anchored to the cat's near edge. Only use a side when the
    // tip can extend away from the target, otherwise it spans back over it.
    const bubbleWidth =
      bubbleNode && !bubbleNode.hidden
        ? bubbleNode.offsetWidth
        : innerWidth <= 760
          ? 208
          : 238;
    const sideRight = rect.right + gap + width + bubbleWidth <= innerWidth - 8;
    const sideLeft = rect.left - gap - width - bubbleWidth >= 8;
    const maxY = innerHeight - height - 8;
    let sideY = 0;
    let sideAbove = false;
    let sideBelow = false;
    if (sideRight || sideLeft) {
      // Put the cat beside the target at the lowest point where the bubble can
      // sit above it, or the highest point where it can sit below. Aligning
      // blindly with the target top made the bubble cover a footer control.
      const aboveY = Math.max(rect.top, bubbleHeight + bubbleGap + 8);
      if (aboveY <= maxY) {
        sideY = Math.max(8, aboveY);
        sideAbove = true;
      } else {
        const belowY = Math.min(
          rect.top,
          innerHeight - 8 - bubbleGap - bubbleHeight - height,
        );
        if (belowY >= 8) {
          sideY = Math.min(maxY, belowY);
          sideBelow = true;
        }
      }
      if (sideAbove || sideBelow) forcedBubbleSide = sideRight ? 'left' : 'right';
    }
    if (!belowFits && !aboveFits && !sideAbove && !sideBelow) {
      // A full tip can be a little taller than a very short phone allows. Cap
      // it to the room above (or below) and let the bubble scroll its text
      // instead of letting fitBubble shove the cat onto the target.
      const aboveAvailable = Math.max(0, above - 8 - bubbleGap);
      const belowAvailable = Math.max(0, innerHeight - 8 - (below + height + bubbleGap));
      const compactHeight = Math.max(aboveAvailable, belowAvailable);
      // Enough for a readable line and the scroll affordance. A 390px-high
      // landscape phone can leave only ~59px beside a full-width starter row;
      // keeping the bubble there is still better than covering the control.
      if (compactHeight >= 44 && bubbleHeight > compactHeight) {
        bubbleHeight = Math.floor(compactHeight);
        if (bubbleNode) {
          bubbleNode.style.setProperty('--chatty-bubble-max', `${bubbleHeight}px`);
        }
        belowFits = below + height + bubbleHeight + bubbleGap <= innerHeight - 8;
        aboveFits = above - bubbleHeight - bubbleGap >= 8;
      }
    }
    if (belowFits) {
      y = below;
      bubblePosition = 'below';
    } else if (aboveFits) {
      y = above;
      bubblePosition = 'above';
    } else if (sideAbove || sideBelow) {
      x = sideRight ? rect.right + gap : rect.left - gap - width;
      y = sideY;
      bubblePosition = sideAbove ? 'above' : 'below';
    } else {
      // Last resort: pick the side with more room and let fitBubble make the
      // final vertical adjustment; horizontal clamping still keeps the
      // complete bubble inside a narrow phone window.
      const belowRoom = innerHeight - 8 - below;
      const aboveRoom = above - 8;
      if (belowRoom >= aboveRoom) {
        y = Math.max(8, Math.min(below, maxY));
        bubblePosition = 'below';
      } else {
        y = Math.max(8, above);
        bubblePosition = 'above';
      }
    }
    y = Math.max(8, Math.min(maxY, y));
    rootNode.dataset.pos = 'tour';
    rootNode.style.left = `${Math.round(x)}px`;
    rootNode.style.top = `${Math.round(y)}px`;
    rootNode.style.right = 'auto';
    rootNode.style.bottom = 'auto';
    rootNode.dataset.bubble = bubblePosition;
    rootNode.dataset.bubbleSide =
      forcedBubbleSide || (x + width / 2 < innerWidth / 2 ? 'left' : 'right');
  }

  /**
   * Move on the compositor: measure where she is, apply the destination, then
   * animate the visual difference away along a curved path. The destination
   * snaps into place under an inline opacity-only transition; the visible trip
   * is a Web Animation, so an enter or translate transition cannot replay it.
   * Returns the animation length in milliseconds, or 0 when she was already
   * there, motion is reduced, or the browser cannot animate.
   */
  function glideBy(applyPlacement) {
    if (!rootNode) return 0;
    if (glideAnimation) {
      const previous = glideAnimation;
      glideAnimation = null;
      previous.cancel();
    }
    const before = rootNode.getBoundingClientRect();
    // Mute any position/transform transition *before* moving so the rect below
    // reports the destination rather than a frame of a stale transition.
    rootNode.style.transition = 'opacity .22s ease';
    applyPlacement();
    const after = rootNode.getBoundingClientRect();
    const dx = Math.round(before.left - after.left);
    const dy = Math.round(before.top - after.top);
    const distance = Math.hypot(dx, dy);
    if (REDUCE_MOTION || distance < 4 || typeof rootNode.animate !== 'function') {
      rootNode.style.transition = '';
      return 0;
    }
    // Long, readable travel: a control-board sweep has to look like walking,
    // not a cut. The cap still keeps a full-width trip under 1.2s.
    const duration = Math.round(Math.min(1200, 620 + distance * 0.55));
    const lift = Math.min(34, 10 + distance * 0.04);
    const sway = Math.min(18, 5 + distance * 0.025);
    // The spotlight starts its move at the same time and lasts exactly as long
    // as the cat, so the ring cannot arrive early and make the destination look
    // like a second, separate teleport.
    if (spotNode && !spotNode.hidden) {
      spotNode.style.setProperty('--chatty-spot-ms', `${duration}ms`);
    }
    const animation = rootNode.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)` },
        {
          transform: `translate(${Math.round(dx * 0.7 + sway)}px, ${Math.round(dy * 0.7 - lift)}px)`,
          offset: 0.3,
        },
        {
          transform: `translate(${Math.round(dx * 0.32 - sway)}px, ${Math.round(dy * 0.32 - lift * 0.55)}px)`,
          offset: 0.64,
        },
        { transform: 'translate(0px, 0px)' },
      ],
      { duration, easing: 'cubic-bezier(.4,0,.2,1)' },
    );
    glideAnimation = animation;
    const release = () => {
      if (glideAnimation !== animation) return;
      glideAnimation = null;
      if (rootNode) rootNode.style.transition = '';
    };
    animation.addEventListener('finish', release, { once: true });
    animation.addEventListener('cancel', release, { once: true });
    return duration;
  }

  function cancelGlide() {
    if (!glideAnimation) return;
    const animation = glideAnimation;
    glideAnimation = null;
    animation.cancel();
    if (rootNode) rootNode.style.transition = '';
  }

  function glideTo(target, bubbleHeight = 0) {
    return glideBy(() => placeNear(target, bubbleHeight));
  }

  function showSpotlight(target, moveMs = 420) {
    if (!spotNode || !visibleTarget(target)) {
      hideSpotlight();
      return;
    }
    const rect = target.getBoundingClientRect();
    spotNode.style.setProperty('--chatty-spot-ms', `${Math.max(0, moveMs)}ms`);
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

  function fitToComposer() {
    if (!rootNode || rootNode.dataset.pos === 'tour') return;
    const footer = document.querySelector('footer');
    const rect = footer ? footer.getBoundingClientRect() : null;
    // The cloud footer is much taller than the desktop one on a phone. Keep the
    // pet above the composer instead of trusting a fixed bottom offset.
    const clearance =
      rect && rect.height > 0 && rect.top > innerHeight * 0.25 && rect.top < innerHeight
        ? Math.ceil(innerHeight - rect.top + 12)
        : 0;
    if (clearance > 0) rootNode.style.setProperty('--chatty-clearance', `${clearance}px`);
    else rootNode.style.removeProperty('--chatty-clearance');
  }

  function choosePosition() {
    if (!rootNode) return;
    rootNode.classList.remove('is-touring');
    clearTourPlacement();
    const options = POSITIONS.filter((position) => position !== lastPosition);
    lastPosition = options[Math.floor(Math.random() * options.length)] || 'br';
    // Set the edge before measuring the composer clearance; clearTourPlacement
    // leaves the old "tour" marker in place for one frame otherwise.
    rootNode.dataset.pos = lastPosition;
    fitToComposer();
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
    bubbleNode.style.setProperty('--chatty-bubble-shift', '0px');
    const bubble = bubbleNode.getBoundingClientRect();
    const root = rootNode.getBoundingClientRect();
    // A right-aligned bubble can hang off the left edge when the cat is near
    // the middle of a 320px window. Clamp the bubble itself rather than moving
    // the cat under the control; moving the cat here was the late correction
    // that made the tour look like a second teleport.
    const horizontal =
      bubble.left < margin
        ? margin - bubble.left
        : bubble.right > innerWidth - margin
          ? innerWidth - margin - bubble.right
          : 0;
    if (horizontal) {
      bubbleNode.style.setProperty('--chatty-bubble-shift', `${Math.round(horizontal)}px`);
    }
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

  function showTip(message, duration = 13000, actions = null, label = 'Chatty', keepSpot = false) {
    if (!bubbleNode) return;
    if (!keepSpot) hideSpotlight();
    bubbleNode.style.setProperty('--chatty-bubble-shift', '0px');
    if (!keepSpot) bubbleNode.style.removeProperty('--chatty-bubble-max');
    textNode.textContent = message;
    if (labelNode) labelNode.textContent = label;
    renderActions(actions);
    // Travel before the bubble becomes visible, so its size is measured where
    // the cat actually lands. The tour passes keepSpot and keeps its own route.
    if (!keepSpot && !REDUCE_MOTION) {
      const target = targetForMessage(message);
      if (target) {
        placeNear(target);
        showSpotlight(target);
      }
    }
    bubbleNode.hidden = false;
    requestAnimationFrame(fitBubble);
    setTimeout(fitBubble, 260);
    clearTimeout(tipTimer);
    if (duration > 0) tipTimer = setTimeout(hideTip, duration);
  }

  function hideTip(keepSpot = false) {
    clearTimeout(tipTimer);
    if (bubbleNode) bubbleNode.hidden = true;
    renderActions(null);
    if (!keepSpot) hideSpotlight();
  }

  function cancelBall() {
    clearTimeout(playTimer);
    clearTimeout(playEndTimer);
    playTimer = 0;
    playEndTimer = 0;
    ballPlaying = false;
    if (rootNode) rootNode.classList.remove('is-playing');
    if (ballNode) ballNode.hidden = true;
  }

  function finishBallPlay() {
    playEndTimer = 0;
    ballPlaying = false;
    if (rootNode) rootNode.classList.remove('is-playing');
    if (ballNode) ballNode.hidden = true;
    if (enabled) scheduleBall();
  }

  function scheduleBall(delay = PLAY_MIN_MS + Math.random() * (PLAY_MAX_MS - PLAY_MIN_MS)) {
    clearTimeout(playTimer);
    playTimer = 0;
    if (!enabled || REDUCE_MOTION) return;
    playTimer = setTimeout(playBall, Math.max(6000, delay));
  }

  function playBall() {
    playTimer = 0;
    if (
      !enabled ||
      REDUCE_MOTION ||
      !rootNode ||
      !ballNode ||
      rootNode.hidden ||
      !rootNode.classList.contains('is-in') ||
      ballPlaying ||
      isBlocked() ||
      rootNode.classList.contains('is-wandering')
    ) {
      if (enabled) scheduleBall(12000);
      return;
    }
    if (tourStep >= 0 || tourBusy || tutorStep >= 0 || (bubbleNode && !bubbleNode.hidden)) {
      // A tip is talking. Wait for it to close, but stay visible long enough for
      // the game to happen instead of letting the idle hide timer cancel it.
      armHide(24000);
      scheduleBall(6000);
      return;
    }
    ballPlaying = true;
    ballNode.hidden = false;
    rootNode.classList.add('is-playing');
    pouncePet();
    spawnHeart();
    armHide(36000);
    clearTimeout(playEndTimer);
    playEndTimer = setTimeout(finishBallPlay, 3200);
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
    if (tutorStep >= 0 || ballPlaying) {
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
        showTip(message, 10000);
        placeNear(tour.target);
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
    cancelGlide();
    cancelBall();
    tutorStep = -1;
    tutorLesson = null;
    wanderCount = TOUR_LIMIT;
    tourStep = -1;
    tourBusy = false;
    if (rootNode.hidden) {
      choosePosition();
      rootNode.hidden = false;
      enterSoon();
    }
    showTourStep(0);
  }

  function showTourStep(start) {
    if (!enabled || !rootNode || rootNode.hidden) return;
    // A phone in landscape can put starter prompts below the fold. They are
    // still part of the control board, so include rendered controls and bring
    // the next one into view before the cat travels to it.
    const found = findTourTarget(start, true);
    if (!found) {
      finishTour();
      return;
    }
    tourStep = found.index;
    tourBusy = true;
    const actions = tourActions(found.index);
    const label = `Tour ${found.index + 1}/${TOUR_STOPS.length}`;
    hideTip(true);
    hideSpotlight();
    clearTimeout(hideTimer);
    clearTimeout(wanderTimer);
    clearTimeout(moveTimer);

    const begin = () => {
      if (!enabled || !rootNode || rootNode.hidden || tourStep !== found.index) return;
      if (!onScreen(found.target)) {
        tourBusy = false;
        showTourStep(found.index + 1);
        return;
      }
      // Lay out the real sentence before moving. A fixed reserved height cannot
      // cover both a narrow phone and a short landscape window, and correcting
      // after the bubble appears is visible as a hop.
      const bubbleHeight = measureBubble(found.stop.tip, actions, label);
      const arrive = () => {
        moveTimer = 0;
        if (!enabled || !rootNode || rootNode.hidden || tourStep !== found.index) return;
        rootNode.classList.remove('is-touring');
        if (!visibleTarget(found.target)) {
          tourBusy = false;
          showTourStep(found.index + 1);
          return;
        }
        showTip(found.stop.tip, 0, actions, label, true);
        // Do not re-place the cat after the bubble becomes visible. The travel
        // placement deliberately reserves a bubble; re-measuring here made the
        // cat correct itself after landing, which read as a second teleport.
        showSpotlight(found.target, 0);
        pouncePet();
        tourBusy = false;
        armHide(180000);
      };
      if (REDUCE_MOTION) {
        // No glide runs in reduced motion, so apply the destination directly.
        placeNear(found.target, bubbleHeight);
        arrive();
        return;
      }
      // Keep the cat visible while she travels so the user can follow the hop,
      // then land with a pounce. The old fade made the movement look like a redraw.
      rootNode.classList.remove('is-wandering');
      if (petNode) {
        petNode.classList.remove('chatty-pounce');
        clearTimeout(pounceTimer);
      }
      const moveMs = glideTo(found.target, bubbleHeight);
      rootNode.style.setProperty('--chatty-move-ms', `${moveMs || 520}ms`);
      showSpotlight(found.target, moveMs || 520);
      rootNode.classList.add('is-touring');
      moveTimer = setTimeout(arrive, moveMs ? moveMs + 20 : 470);
    };

    if (onScreen(found.target)) {
      begin();
      return;
    }
    found.target.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: REDUCE_MOTION ? 'auto' : 'smooth',
    });
    // Wait for smooth scrolling to settle. Measuring or placing before it does
    // would send the cat to where the control used to be.
    const started = Date.now();
    let lastTop = null;
    let stable = 0;
    const poll = () => {
      if (!enabled || !rootNode || rootNode.hidden || tourStep !== found.index) return;
      const top = found.target.getBoundingClientRect().top;
      if (lastTop !== null && Math.abs(top - lastTop) < 1 && onScreen(found.target)) stable += 1;
      else stable = 0;
      lastTop = top;
      if (stable >= 2 || Date.now() - started > 1100) {
        begin();
        return;
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
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
    if (rootNode) rootNode.classList.remove('is-touring');
    tourStep = -1;
    tourBusy = false;
    writeFlag(TOUR_KEY, '1');
    wanderCount = TOUR_LIMIT;
    hideSpotlight();
    showTip(
      "That's the tour! You know where everything lives now. Click me any time for a tip, a joke, a pounce, a Cat school lesson, or Settings.",
      16000,
      TUTOR_ACTIONS,
    );
    spawnHeart(3);
    armHide(28000);
    scheduleBall(10000 + Math.random() * 8000);
  }

  function abandonTour() {
    if (rootNode) rootNode.classList.remove('is-touring');
    tourStep = -1;
    tourBusy = false;
    writeFlag(TOUR_KEY, '1');
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
    enterSoon();
  }

  function moveTutorStep() {
    if (!rootNode) return 0;
    rootNode.classList.remove('is-wandering');
    const options = POSITIONS.filter((position) => position !== lastPosition);
    lastPosition = options[Math.floor(Math.random() * options.length)] || 'br';
    const next = lastPosition;
    const duration = glideBy(() => {
      clearTourPlacement();
      rootNode.dataset.pos = next;
      fitToComposer();
    });
    if (!duration) {
      rootNode.classList.remove('is-touring');
      return 0;
    }
    rootNode.style.setProperty('--chatty-move-ms', `${duration}ms`);
    rootNode.classList.add('is-touring');
    return duration;
  }

  function showTutorStep({ move = false } = {}) {
    if (!enabled || !rootNode || !tutorLesson || tutorStep < 0 || isBlocked()) return;
    const lesson = tutorLesson;
    const step = tutorStep;
    if (step >= lesson.steps.length) {
      finishTutor();
      return;
    }
    const render = () => {
      if (!enabled || !rootNode || tutorLesson !== lesson || tutorStep !== step || isBlocked()) return;
      const last = step === lesson.steps.length - 1;
      showTip(
        lesson.steps[step],
        0,
        [
          { action: 'tutor-next', label: last ? 'Finish lesson' : 'Next paw', primary: true },
          { action: 'tutor-stop', label: 'Stop' },
        ],
        `Cat school ${step + 1}/${lesson.steps.length}`,
      );
      armHide(180000);
    };
    clearTimeout(moveTimer);
    moveTimer = 0;
    if (!move) {
      render();
      return;
    }
    // Hide the old sentence before she travels so the next step cannot appear
    // at the old corner while the pet is still hopping to the new one.
    hideTip();
    const duration = moveTutorStep();
    if (!duration) {
      render();
      return;
    }
    moveTimer = setTimeout(() => {
      moveTimer = 0;
      if (rootNode) rootNode.classList.remove('is-touring');
      render();
    }, duration + 24);
  }

  function startTutor(title = '') {
    if (!enabled || !rootNode || isBlocked()) return;
    clearTimeout(appearTimer);
    clearTimeout(hideTimer);
    clearTimeout(wanderTimer);
    clearTimeout(moveTimer);
    cancelGlide();
    cancelBall();
    if (tourStep >= 0 || tourBusy) {
      tourStep = -1;
      tourBusy = false;
      hideSpotlight();
      rootNode.classList.remove('is-wandering');
    }
    const wasHidden = rootNode.hidden;
    const requested = title ? LESSONS.findIndex((lesson) => lesson.title === title) : -1;
    if (requested >= 0) {
      lastLesson = requested;
      tutorLesson = LESSONS[requested];
    } else {
      tutorLesson = pickLesson();
    }
    tutorStep = 0;
    makeVisible();
    showTutorStep({ move: !wasHidden });
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
    showTutorStep({ move: true });
  }

  function finishTutor() {
    if (!tutorLesson) {
      stopTutor();
      return;
    }
    const lesson = tutorLesson;
    tutorStep = -1;
    tutorLesson = null;
    clearTimeout(moveTimer);
    moveTimer = 0;
    if (rootNode) rootNode.classList.remove('is-touring', 'is-wandering');
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
    scheduleBall(10000 + Math.random() * 8000);
  }

  function stopTutor() {
    tutorStep = -1;
    tutorLesson = null;
    clearTimeout(moveTimer);
    moveTimer = 0;
    if (rootNode) rootNode.classList.remove('is-touring', 'is-wandering');
    if (labelNode) labelNode.textContent = 'Chatty';
    showTip(
      'Class dismissed. I will be in the corner, pretending not to knock something off the desk.',
      9000,
      TUTOR_ACTIONS,
    );
    armHide(16000);
    scheduleBall(10000 + Math.random() * 8000);
  }

  // One pending entry frame. Hiding before it runs must cancel it, or a quick
  // show-then-dismiss leaves the cat on screen with no bubble.
  function enterSoon() {
    cancelAnimationFrame(enterRaf);
    enterRaf = requestAnimationFrame(() => {
      enterRaf = 0;
      if (rootNode && !rootNode.hidden) rootNode.classList.add('is-in');
    });
  }

  function show() {
    if (!enabled || isBlocked()) {
      if (enabled) schedule(22000);
      return;
    }
    if (tourStep >= 0 || tutorStep >= 0) return;
    clearTimeout(appearTimer);
    if (!rootNode) return;
    fitToComposer();
    if (rootNode.hidden) {
      wanderCount = 0;
      choosePosition();
      rootNode.hidden = false;
    }
    enterSoon();
    armHide(26000);
    if (!playTimer && !ballPlaying) scheduleBall(10000 + Math.random() * 8000);
    const tourDone = readFlag(TOUR_KEY, '') === '1';
    if (isEditable(document.activeElement) && hasUserActed) {
      hideTip();
    } else if (!tourDone) {
      // The control board comes before tips, lessons, or the welcome card:
      // a first-time visitor gets the whole map in one guided pass.
      startTour();
      return;
    } else if (Math.random() < 0.72) {
      if (!showPromptCoach()) showTip(pickMessage(), 13000, TUTOR_ACTIONS);
    }
    if (tourDone) scheduleWander();
    if (pointer) lookAt();
  }

  // A finished plan is a real hand-off point: bring Chatty up even when the
  // composer still has focus, and put the mode switch one click away.
  function planReady() {
    if (!enabled || !rootNode) return;
    if (isBlocked() || tourStep >= 0 || tutorStep >= 0) return;
    clearTimeout(appearTimer);
    fitToComposer();
    if (rootNode.hidden) {
      wanderCount = 0;
      choosePosition();
      rootNode.hidden = false;
    }
    enterSoon();
    armHide(36000);
    showTip(
      'The plan is ready. Review the steps, then switch to Build when you approve. Build still asks before it writes anything.',
      22000,
      PLAN_ACTIONS,
      'Plan ready',
    );
    pouncePet();
  }

  function hide(cooldown = 42000 + Math.random() * 33000) {
    clearTimeout(appearTimer);
    cancelAnimationFrame(enterRaf);
    enterRaf = 0;
    clearTimeout(hideTimer);
    clearTimeout(tipTimer);
    clearTimeout(pounceTimer);
    clearTimeout(spinTimer);
    clearTimeout(winkTimer);
    clearTimeout(wanderTimer);
    clearTimeout(moveTimer);
    cancelGlide();
    cancelBall();
    if (!rootNode) return;
    if (rootNode.contains(document.activeElement)) document.activeElement.blur();
    if (tourStep >= 0 || tourBusy) {
      // An automatic hide is not a decision. Leave the flag alone so the next
      // appearance resumes the tour where it stopped instead of silently
      // turning every later visit into a wandering cat with no lesson.
      if (tourTarget) tourCursor = Math.max(0, tourCursor - 1);
      tourStep = -1;
      tourBusy = false;
    }
    tutorStep = -1;
    tutorLesson = null;
    if (labelNode) labelNode.textContent = 'Chatty';
    renderActions(null);
    hideTip();
    petNode.classList.remove('chatty-spin', 'chatty-pounce');
    rootNode.classList.remove('is-winking', 'is-wandering', 'is-touring');
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
    if (tourStep >= 0 || tourBusy) writeFlag(TOUR_KEY, '1');
    hide(DISMISS_MIN_MS + Math.random() * (DISMISS_MAX_MS - DISMISS_MIN_MS));
  }

  function schedule(delay, force = false) {
    clearTimeout(appearTimer);
    if (!enabled) return;
    appearTimer = setTimeout(() => {
      if (!enabled) return;
      const idleFor = Date.now() - lastActivity;
      // A first-time visitor gets the control-board tour on the first launch
      // window, not after the returning-user idle threshold. show() itself
      // still backs off if the composer has focus or a panel is open.
      if (!force && idleFor < IDLE_MIN_MS && readFlag(TOUR_KEY, '') === '1') {
        schedule(IDLE_MIN_MS - idleFor + 350);
        return;
      }
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
      cancelAnimationFrame(enterRaf);
      enterRaf = 0;
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
      cancelBall();
      cancelGlide();
      renderActions(null);
      hideTip();
      hideSpotlight();
      document.querySelectorAll('.chatty-settings-note').forEach((node) => node.remove());
      petNode.classList.remove('chatty-spin', 'chatty-pounce');
      rootNode.classList.remove('is-in', 'is-winking', 'is-wandering', 'is-touring');
      rootNode.querySelectorAll('.chatty-heart').forEach((heart) => heart.remove());
      rootNode.hidden = true;
      resetLook();
      return;
    }
    schedule(1400, true);
    scheduleBall(10000 + Math.random() * 8000);
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
      if (!rootNode) return;
      if (rootNode.dataset.pos !== 'tour') fitToComposer();
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
      <span class="chatty-ball" aria-hidden="true" hidden>
        <svg viewBox="0 0 56 56" focusable="false">
          <circle cx="28" cy="28" r="20" fill="#f6c85f" stroke="#f4efe3" stroke-width="2.4"/>
          <path d="M13 22c11-4 23 0 29 10M11 32c12 5 25 0 32-9M18 43c8-12 22-17 27-9M36 11c-9 10-10 22-5 32" fill="none" stroke="#c2552b" stroke-width="2.2" stroke-linecap="round"/>
        </svg>
      </span>
    `;
    document.body.append(rootNode);

    petNode = rootNode.querySelector('.chatty-pet');
    bubbleNode = rootNode.querySelector('.chatty-bubble');
    textNode = rootNode.querySelector('.chatty-text');
    labelNode = rootNode.querySelector('.chatty-label');
    actionsNode = rootNode.querySelector('.chatty-actions');
    ballNode = rootNode.querySelector('.chatty-ball');
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
      else if (action === 'prompt-lesson') startTutor(PROMPT_LESSON);
      else if (action === 'tutor-next') advanceTutor();
      else if (action === 'tutor-another') startTutor();
      else if (action === 'tutor-stop') stopTutor();
      else if (action === 'tour') startTour();
      else if (action === 'next') advanceTour();
      else if (action === 'skip') abandonTour();
      else if (action === 'build') {
        const build = document.querySelector('#modeBuild');
        if (!build) {
          showTip('I cannot find the Build switch on this page. The plan card can start it when you are ready.', 9000);
          return;
        }
        build.click();
        showTip('Build mode is on. The first write or command still asks for your approval.', 14000);
        armHide(30000);
      }
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
      if (ballPlaying) cancelBall();
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
        if (readFlag(TOUR_KEY, '') === '1' && showPromptCoach()) {
          // The prompt coach owns this bubble and its Prompt lesson action.
        } else if (readFlag(TOUR_KEY, '') === '1') {
          showTip(pickMessage(), 13000, TUTOR_ACTIONS);
        } else {
          showTip(WELCOME, 24000, WELCOME_ACTIONS);
        }
      } else hideTip();
      pouncePet();
      spawnHeart();
      armHide(26000);
      if (readFlag(TOUR_KEY, '') === '1') scheduleWander();
    });
    petNode.addEventListener('dblclick', (event) => {
      event.preventDefault();
      if (!enabled || REDUCE_MOTION || tourStep >= 0 || tutorStep >= 0) return;
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

    for (const eventName of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'touchmove']) {
      document.addEventListener(eventName, noteActivity, { passive: true });
    }
    document.addEventListener('scroll', noteActivity, { passive: true, capture: true });
    document.addEventListener('focusin', noteActivity);
    // The desktop focuses the composer on boot. That autofocus is not the user
    // typing, so Chatty's one-time welcome must still be allowed over it.
    for (const eventName of ['pointerdown', 'keydown', 'touchstart']) {
      document.addEventListener(eventName, () => { hasUserActed = true; }, {
        once: true,
        capture: true,
        passive: true,
      });
    }

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
      if (document.hidden) {
        hide();
      } else if (enabled) {
        noteActivity();
        schedule(5000);
      }
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
      if (enabled) {
        schedule(1200);
        scheduleBall(10000 + Math.random() * 8000);
      } else {
        cancelAnimationFrame(enterRaf);
        enterRaf = 0;
        clearTimeout(appearTimer);
        clearTimeout(hideTimer);
        clearTimeout(wanderTimer);
        clearTimeout(moveTimer);
        cancelBall();
        cancelGlide();
        tourStep = -1;
        tourBusy = false;
        tutorStep = -1;
        tutorLesson = null;
        renderActions(null);
        hideTip();
        hideSpotlight();
        document.querySelectorAll('.chatty-settings-note').forEach((node) => node.remove());
        rootNode.classList.remove('is-in', 'is-winking', 'is-wandering', 'is-touring');
        rootNode.hidden = true;
        resetLook();
      }
    });

    if (enabled) schedule(5200 + Math.random() * 2800);
    if (enabled) scheduleBall(10000 + Math.random() * 8000);
  }

  const api = {
    isEnabled,
    setEnabled,
    show: () => show(),
    hide,
    tutor: () => startTutor(),
    tour: () => startTour(),
    settings: () => openSettings(),
    ready: playReadyChime,
    planReady: () => planReady(),
    coach: () => showPromptCoach(true),
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
