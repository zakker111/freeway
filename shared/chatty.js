/* Chatty — Freeway's tiny corner companion.
 *
 * One runtime for the desktop and cloud pages. It owns its styles and DOM so
 * both editions stay identical, and it only ever reads/writes the local
 * Chatty preference. It never touches chats, keys or provider requests.
 */
(function (root) {
  'use strict';

  const ENABLED_KEY = 'freeway.chatty.enabled';
  const SEEN_KEY = 'freeway.chatty.seen';
  const POSITIONS = ['br', 'bl', 'rm', 'lm'];
  const DISMISS_MIN_MS = 2 * 60 * 1000;
  const DISMISS_MAX_MS = 3.5 * 60 * 1000;
  const WELCOME =
    "Hi, I'm Chatty, your tiny Freeway sidekick. Click me for a tip, double-click for a trick, and switch me off in Settings whenever you like.";
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
    'I know where your cursor is. It is my only party trick.',
    'Free models do the heavy lifting; I supervise.',
    'If a reply is long, use the copy button at the top of it.',
    'A clean slate is one New chat away.',
    'The best tip is the one you close before it gets annoying.',    'The Files rail is the one room I am not allowed in.',
  ];
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
  ];
  const FUNNY_CHANCE = 0.3;

  const REDUCE_MOTION =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const STYLE = `
    .chatty {
      position: fixed;
      z-index: 12;
      width: 84px;
      opacity: 0;
      transform: var(--chatty-enter, translateY(9px)) scale(.96);
      transform-origin: 50% 100%;
      transition: opacity .22s ease, transform .28s cubic-bezier(.2,.8,.2,1);
      pointer-events: none;
    }
    .chatty[hidden] { display: none; }
    .chatty.is-in { opacity: 1; transform: translate(0, 0) scale(1); }
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
    .chatty.is-in .chatty-pet.chatty-poke { animation: chatty-poke .32s ease-out; }
    .chatty.is-in .chatty-pet.chatty-spin { animation: chatty-spin .82s cubic-bezier(.2,.8,.2,1); }
    .chatty-pet.chatty-poke { animation: chatty-poke .32s ease-out; }
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
    @keyframes chatty-poke {
      0% { transform: scale(1) rotate(0); }
      35% { transform: scale(1.06) rotate(-4deg); }
      70% { transform: scale(.98) rotate(3deg); }
      100% { transform: scale(1) rotate(0); }
    }
    @keyframes chatty-tip-in {
      from { opacity: 0; transform: translateY(4px) scale(.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes chatty-blink {
      0%, 92%, 100% { transform: scaleY(1); }
      95%, 97% { transform: scaleY(.08); }
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
      0%, 70%, 100% { transform: rotate(0deg); }
      75% { transform: rotate(-2.2deg); }
      81% { transform: rotate(1.4deg); }
      87% { transform: rotate(0deg); }
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
      .chatty.is-in .chatty-pet,
      .chatty.is-in .chatty-eye,
      .chatty.is-in .chatty-tail,
      .chatty.is-in .chatty-ear-left,
      .chatty.is-in .chatty-ear-right,
      .chatty.is-in .chatty-head,
      .chatty.is-in .chatty-paw-left,
      .chatty.is-in .chatty-paw-right,
      .chatty.is-in .chatty-pet.chatty-spin,
      .chatty-heart { animation: none; }
      .chatty-heart { display: none; }
      .chatty-pet.chatty-poke { animation: none; }
    }
  `;

  const ART = `
    <svg class="chatty-art" viewBox="0 0 220 240" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="chatty-bg" cx="50%" cy="32%" r="76%">
          <stop offset="0%" stop-color="#f8fffa"/>
          <stop offset="48%" stop-color="#d7f4e8"/>
          <stop offset="100%" stop-color="#8fd6c4"/>
        </radialGradient>
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
      <circle cx="110" cy="120" r="106" fill="url(#chatty-bg)" stroke="#163a38" stroke-width="6"/>
      <g fill="#fff8e7" opacity=".8">
        <path d="M39 66l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/>
        <path d="M184 82l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z" opacity=".8"/>
        <circle cx="36" cy="150" r="3" fill="#ee7287" opacity=".55"/>
      </g>
      <path class="chatty-tail" d="M154 198c25 3 39-11 32-28-5-11-17-12-21-4" fill="none" stroke="#101018" stroke-width="12" stroke-linecap="round"/>
      <ellipse cx="110" cy="190" rx="45" ry="40" fill="url(#chatty-body)"/>
      <ellipse class="chatty-paw chatty-paw-left" cx="92" cy="220" rx="20" ry="11" fill="#171722"/>
      <ellipse class="chatty-paw chatty-paw-right" cx="128" cy="220" rx="20" ry="11" fill="#171722"/>
      <g fill="none" stroke="#3d3b4c" stroke-width="2.5" stroke-linecap="round" opacity=".7">
        <path d="M84 218q6 5 12 0M104 222q6 5 12 0M118 218q6 5 12 0M138 222q6 5 12 0"/>
      </g>
      <g class="chatty-head">
      <g class="chatty-ear chatty-ear-left">
        <path d="M72 83 46 26l50 28z" fill="url(#chatty-fur)"/>
        <path d="M64 72 50 39l34 18z" fill="url(#chatty-pink)" opacity=".82"/>
      </g>
      <g class="chatty-ear chatty-ear-right">
        <path d="M148 83 174 26l-50 28z" fill="url(#chatty-fur)"/>
        <path d="M156 72 170 39l-34 18z" fill="url(#chatty-pink)" opacity=".82"/>
      </g>
      <path d="M110 56c-38 0-54 24-51 53 3 30 23 49 51 49s48-19 51-49c3-29-13-53-51-53z" fill="url(#chatty-fur)"/>
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
      <g class="chatty-eye">
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
  let appearTimer = 0;
  let hideTimer = 0;
  let tipTimer = 0;
  let pokeTimer = 0;
  let spinTimer = 0;
  let raf = 0;
  let lastTip = -1;
  let lastJoke = -1;
  let lastWasFunny = false;
  let lastPosition = '';
  let pointer = null;

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

  function pickTip() {
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

  function choosePosition() {
    const options = POSITIONS.filter((position) => position !== lastPosition);
    lastPosition = options[Math.floor(Math.random() * options.length)] || 'br';
    rootNode.dataset.pos = lastPosition;
  }

  function resetLook() {
    if (!rootNode) return;
    rootNode.style.setProperty('--chatty-tilt', '0deg');
    for (const iris of rootNode.querySelectorAll('.chatty-iris')) {
      iris.style.transform = 'translate(0, 0)';
    }
  }

  function lookAt() {
    if (!pointer || !rootNode || rootNode.hidden || REDUCE_MOTION) return;
    const rect = petNode.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dx = Math.max(-1, Math.min(1, (pointer.x - (rect.left + rect.width / 2)) / (rect.width * 0.72)));
    const dy = Math.max(-1, Math.min(1, (pointer.y - (rect.top + rect.height / 2)) / (rect.height * 0.72)));
    rootNode.style.setProperty('--chatty-tilt', `${(dx * 2.2).toFixed(2)}deg`);
    for (const iris of rootNode.querySelectorAll('.chatty-iris')) {
      iris.style.transform = `translate(${(dx * 2.2).toFixed(2)}px, ${(dy * 1.4).toFixed(2)}px)`;
    }
  }

  function showTip(message) {
    if (!bubbleNode) return;
    textNode.textContent = message;
    bubbleNode.hidden = false;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(hideTip, 13000);
  }

  function hideTip() {
    clearTimeout(tipTimer);
    if (bubbleNode) bubbleNode.hidden = true;
  }

  function armHide(delay) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, delay);
  }

  function show() {
    if (!enabled || isBlocked()) {
      if (enabled) schedule(22000);
      return;
    }
    clearTimeout(appearTimer);
    if (!rootNode) return;
    if (rootNode.hidden) {
      choosePosition();
      rootNode.hidden = false;
    }
    requestAnimationFrame(() => rootNode.classList.add('is-in'));
    armHide(19000);
    if (isEditable(document.activeElement)) {
      hideTip();
    } else if (readFlag(SEEN_KEY, '') !== '1') {
      writeFlag(SEEN_KEY, '1');
      showTip(WELCOME);
      armHide(24000);
    } else if (Math.random() < 0.58) {
      showTip(pickMessage());
    }
    if (pointer) lookAt();
  }

  function hide(cooldown = 42000 + Math.random() * 33000) {
    clearTimeout(appearTimer);
    clearTimeout(hideTimer);
    clearTimeout(tipTimer);
    clearTimeout(spinTimer);
    if (!rootNode) return;
    if (rootNode.contains(document.activeElement)) document.activeElement.blur();
    hideTip();
    petNode.classList.remove('chatty-spin');
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
      clearTimeout(spinTimer);
      hideTip();
      petNode.classList.remove('chatty-spin');
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

    rootNode = document.createElement('aside');
    rootNode.id = 'chatty';
    rootNode.className = 'chatty';
    rootNode.dataset.pos = 'br';
    rootNode.hidden = true;
    rootNode.setAttribute('aria-label', 'Chatty');
    rootNode.innerHTML = `
      <div class="chatty-bubble" role="status" aria-live="polite" title="Click to close this tip and let Chatty wander off." hidden>
        <button class="chatty-close" type="button" aria-label="Close tip and hide Chatty for a while" title="Close tip and hide Chatty for a while">×</button>
        <span class="chatty-label">Chatty</span>
        <span class="chatty-text"></span>
      </div>
      <button class="chatty-pet" type="button" tabindex="-1" aria-label="Chatty the Freeway cat. Click for a tip; double-click for a trick.">
        ${ART}
      </button>
    `;
    document.body.append(rootNode);

    petNode = rootNode.querySelector('.chatty-pet');
    bubbleNode = rootNode.querySelector('.chatty-bubble');
    textNode = rootNode.querySelector('.chatty-text');
    rootNode.querySelector('.chatty-close').addEventListener('click', (event) => {
      event.stopPropagation();
      dismiss();
    });
    bubbleNode.addEventListener('click', (event) => {
      if (!enabled) return;
      event.stopPropagation();
      dismiss();
    });
    petNode.addEventListener('click', () => {
      if (!enabled) return;
      if (bubbleNode.hidden) showTip(pickMessage());
      else hideTip();
      petNode.classList.remove('chatty-poke');
      void petNode.offsetWidth;
      petNode.classList.add('chatty-poke');
      clearTimeout(pokeTimer);
      pokeTimer = setTimeout(() => petNode.classList.remove('chatty-poke'), 360);
      spawnHeart();
      armHide(19000);
    });
    petNode.addEventListener('dblclick', (event) => {
      event.preventDefault();
      if (!enabled || REDUCE_MOTION) return;
      petNode.classList.remove('chatty-spin');
      void petNode.offsetWidth;
      petNode.classList.add('chatty-spin');
      clearTimeout(spinTimer);
      spinTimer = setTimeout(() => petNode.classList.remove('chatty-spin'), 900);
      spawnHeart(3);
      showTip('Wheee! That was my whole trick. I hope it was worth it.');
      armHide(16000);
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
        if (rootNode.contains(event.target)) return;
        setTimeout(() => {
          if (isBlocked()) hide();
        }, 0);
      },
      true,
    );
    document.addEventListener('focusin', (event) => {
      if (isEditable(event.target)) hideTip();
    });
    document.addEventListener(
      'wheel',
      () => {
        if (bubbleNode && !bubbleNode.hidden) hideTip();
      },
      { passive: true },
    );
    document.addEventListener(
      'touchmove',
      () => {
        if (bubbleNode && !bubbleNode.hidden) hideTip();
      },
      { passive: true },
    );
    window.addEventListener('storage', (event) => {
      if (event.key !== ENABLED_KEY) return;
      enabled = readFlag(ENABLED_KEY, '1') !== '0';
      if (enabled) schedule(1200);
      else {
        clearTimeout(appearTimer);
        hideTip();
        rootNode.classList.remove('is-in');
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
