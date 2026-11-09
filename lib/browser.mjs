// An interactive local browser session for the Build loop.
//
// The app has no runtime dependencies and no Playwright install. It uses an
// installed Edge/Chrome over the Chrome DevTools Protocol, the same local
// browser path the screenshot tool already relies on. The browser only opens
// the tokenised loopback preview, never an arbitrary internet address.
//
// The model gets a small, deliberate surface: a text snapshot with stable
// element ids, actions by those ids, console/network diagnostics, and an
// optional screenshot. Every page-changing action returns a fresh snapshot, so
// the model observes the result instead of assuming it.

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { MAX_IMAGE_CHARS } from './models.mjs';
import { browserEnv, findBrowser, screenshotViewport } from './screenshot.mjs';

const BROWSER_READY_TIMEOUT_MS = 15_000;
const BROWSER_COMMAND_TIMEOUT_MS = 15_000;
const BROWSER_ACTION_PAUSE_MS = 350;
const BROWSER_IDLE_MS = 10 * 60 * 1000;
const BROWSER_MAX_EVENTS = 80;
const BROWSER_MAX_TEXT = 12_000;
const BROWSER_MAX_ELEMENTS = 80;
const BROWSER_MAX_SHOTS = 2;
const BROWSER_MAX_CONTENT = 28_000;

const browserSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Only the local, tokenised preview server may be opened by the model. */
export function browserUrlAllowed(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  if (url.username || url.password) return false;
  return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname);
}

/** The exact Chromium arguments for an interactive, isolated profile. */
export function browserLaunchArgs({ profile, port, width = 800, height = 600 }) {
  return [
    '--headless',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--mute-audio',
    // The CDP client is Node's WebSocket, which sends no Origin header. Do not
    // allow browser pages to attach to the debugger just because the port is
    // loopback-only: any local web origin could otherwise drive this profile.
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--force-device-scale-factor=1',
    'about:blank',
  ];
}

/** Page edits that should refresh an already-open browser session. */
export function browserShouldRecheck(name, target = '') {
  if (name === 'scaffold_project') return true;
  if (name !== 'write_file' && name !== 'apply_patch') return false;
  return /\.(html?|css|js|mjs|jsx|tsx?|svg|md|markdown)$/i.test(String(target ?? ''));
}

function browserFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return await response.json();
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = String(error?.message ?? error);
    }
    await browserSleep(120);
  }
  throw new Error(`The local browser did not become ready (${last ?? 'timeout'}).`);
}

class BrowserCdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;

    socket.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.id) {
        const job = this.pending.get(message.id);
        if (!job) return;
        this.pending.delete(message.id);
        clearTimeout(job.timer);
        if (message.error) job.reject(new Error(message.error.message || 'Browser command failed.'));
        else job.resolve(message.result ?? {});
        return;
      }
      if (!message.method) return;
      for (const listener of this.listeners.get(message.method) ?? []) {
        try {
          listener(message.params ?? {});
        } catch {
          /* an observer must never break the connection */
        }
      }
    };
    socket.onclose = () => {
      this.closed = true;
      for (const job of this.pending.values()) {
        clearTimeout(job.timer);
        job.reject(new Error('The browser session closed.'));
      }
      this.pending.clear();
    };
    socket.onerror = () => {
      /* a close event follows; pending calls are rejected there */
    };
  }

  static connect(url, timeoutMs = BROWSER_READY_TIMEOUT_MS) {
    if (typeof WebSocket !== 'function') {
      return Promise.reject(
        new Error('Browser sessions need a Node build with the built-in WebSocket (Node 22 or newer).'),
      );
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          socket.close();
        } catch {
          /* already gone */
        }
        reject(new Error('The browser DevTools connection timed out.'));
      }, timeoutMs);
      timer.unref?.();
      socket.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(new BrowserCdp(socket));
      };
      socket.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('The browser DevTools connection failed.'));
      };
    });
  }

  send(method, params = {}, timeoutMs = BROWSER_COMMAND_TIMEOUT_MS) {
    if (this.closed) return Promise.reject(new Error('The browser session is closed.'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The browser did not answer ${method} in time.`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  on(method, listener) {
    const list = this.listeners.get(method) ?? [];
    list.push(listener);
    this.listeners.set(method, list);
  }

  close() {
    this.closed = true;
    try {
      this.socket.close();
    } catch {
      /* already gone */
    }
    for (const job of this.pending.values()) {
      clearTimeout(job.timer);
      job.reject(new Error('The browser session closed.'));
    }
    this.pending.clear();
  }
}

async function launchBrowser({ env, viewport, spawn, findBrowserImpl }) {
  const executable = findBrowserImpl({ env });
  if (!executable) {
    throw new Error(
      'No local Edge or Chrome was found. Install one, or set FREEWAY_BROWSER to its executable path.',
    );
  }
  if (typeof WebSocket !== 'function') {
    throw new Error('Browser sessions need a Node build with the built-in WebSocket (Node 22 or newer).');
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freeway-browser-'));
  const profile = path.join(dir, 'profile');
  fs.mkdirSync(profile, { recursive: true });
  const port = await browserFreePort();
  const size = screenshotViewport(viewport);
  const args = browserLaunchArgs({ profile, port, width: size.width, height: size.height });
  // Chromium's own sandbox is unavailable when the app runs as root inside a
  // container. Do not disable it for a normal desktop install.
  if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) {
    args.splice(1, 0, '--no-sandbox');
  }

  let child;
  let stderr = '';
  try {
    child = spawn(executable, args, {
      cwd: dir,
      env: browserEnv(env),
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  child.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-4000);
  });

  try {
    const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`, BROWSER_READY_TIMEOUT_MS);
    const target = Array.isArray(targets) ? targets.find((entry) => entry.type === 'page') : null;
    if (!target?.webSocketDebuggerUrl) throw new Error('The browser did not expose a page target.');
    const cdp = await BrowserCdp.connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: size.width,
      height: size.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    return { child, cdp, dir, executable };
  } catch (error) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
    fs.rmSync(dir, { recursive: true, force: true });
    const tail = stderr.trim().split('\n').slice(-2).join(' ').trim();
    throw new Error(`${String(error?.message ?? error)}${tail ? ` (${tail})` : ''}`);
  }
}

function pageSnapshotExpression() {
  return `(() => {
    const clean = (value, limit = 160) => String(value ?? '').replace(/\\s+/g, ' ').trim().slice(0, limit);
    for (const node of document.querySelectorAll('[data-freeway-uid]')) node.removeAttribute('data-freeway-uid');
    const visible = (node) => {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const label = (node) => {
      const explicit = node.getAttribute('aria-label') || node.getAttribute('alt') || node.getAttribute('placeholder') || node.getAttribute('title');
      if (explicit) return clean(explicit);
      if (node.labels && node.labels.length) return clean(node.labels[0].innerText);
      if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT') {
        return clean(node.value || node.getAttribute('name') || node.type);
      }
      return clean(node.innerText || node.textContent || node.getAttribute('name'));
    };
    const role = (node) => {
      const explicit = node.getAttribute('role');
      if (explicit) return explicit;
      if (node.tagName === 'A') return 'link';
      if (node.tagName === 'BUTTON') return 'button';
      if (node.tagName === 'INPUT') return node.type === 'checkbox' ? 'checkbox' : 'input';
      if (node.tagName === 'TEXTAREA') return 'textbox';
      if (node.tagName === 'SELECT') return 'combobox';
      if (node.isContentEditable) return 'textbox';
      return 'control';
    };
    const nodes = [...document.querySelectorAll('a,button,input,textarea,select,summary,[role="button"],[role="link"],[role="checkbox"],[role="tab"],[role="menuitem"],[contenteditable="true"]')]
      .filter((node) => visible(node) && !node.disabled)
      .slice(0, ${BROWSER_MAX_ELEMENTS});
    const elements = nodes.map((node, index) => {
      const uid = 'e' + (index + 1);
      node.setAttribute('data-freeway-uid', uid);
      const type = node.tagName === 'INPUT' ? String(node.type || 'text') : '';
      return {
        uid,
        role: role(node),
        name: label(node),
        tag: node.tagName.toLowerCase(),
        type: type || undefined,
        value: type === 'password' ? '••••' : (type === 'checkbox' || type === 'radio' ? undefined : clean(node.value, 80) || undefined),
        checked: type === 'checkbox' || type === 'radio' ? Boolean(node.checked) : undefined,
        href: node.tagName === 'A' ? clean(node.getAttribute('href'), 200) : undefined,
      };
    });
    return {
      title: document.title,
      url: location.href,
      text: clean(document.body ? document.body.innerText : '', ${BROWSER_MAX_TEXT}),
      elements,
    };
  })()`;
}

function formatBrowserEvents(events) {
  const lines = [];
  if (events.console.length) {
    lines.push('Console:');
    for (const item of events.console.slice(-12)) lines.push(`- ${item}`);
  }
  if (events.network.length) {
    lines.push('Network problems:');
    for (const item of events.network.slice(-12)) lines.push(`- ${item}`);
  }
  return lines;
}

/** Compact, bounded text the model can read without a screenshot. */
export function formatBrowserSnapshot(snapshot, events = { console: [], network: [] }) {
  const lines = [
    `Browser page: ${snapshot.title || '(untitled)'}`,
    `URL: ${snapshot.url}`,
    '',
    'Visible text:',
    snapshot.text || '(empty)',
  ];
  if (snapshot.elements?.length) {
    lines.push('', 'Interactive elements (use these uids):');
    for (const element of snapshot.elements) {
      const bits = [element.uid, element.role, JSON.stringify(element.name || '')];
      if (element.type) bits.push(`type=${element.type}`);
      if (element.value) bits.push(`value=${JSON.stringify(element.value)}`);
      if (element.checked !== undefined) bits.push(element.checked ? 'checked' : 'unchecked');
      if (element.href) bits.push(`href=${element.href}`);
      lines.push(`- ${bits.join(' ')}`);
    }
  } else {
    lines.push('', 'Interactive elements: none found.');
  }
  const diagnostics = formatBrowserEvents(events);
  if (diagnostics.length) lines.push('', ...diagnostics);
  return lines.join('\n').slice(0, BROWSER_MAX_CONTENT);
}

export function createBrowserManager({
  env = process.env,
  spawn = nodeSpawn,
  findBrowserImpl = findBrowser,
  idleMs = BROWSER_IDLE_MS,
} = {}) {
  let session = null;
  let idleTimer = null;
  let screenshots = 0;

  function clearIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  }

  function armIdle() {
    clearIdle();
    idleTimer = setTimeout(() => {
      void close();
    }, idleMs);
    idleTimer.unref?.();
  }

  function events() {
    return session?.events ?? { console: [], network: [] };
  }

  async function evaluate(expression) {
    if (!session) throw new Error('No browser session is open. Call browser_open first.');
    const result = await session.cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text ||
          'The page evaluation failed.',
      );
    }
    return result.result?.value;
  }

  async function waitForReady(timeoutMs = 8_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const state = await evaluate('document.readyState');
        if (state === 'complete' || state === 'interactive') return;
      } catch {
        /* a navigation can invalidate the execution context for a moment */
      }
      await browserSleep(100);
    }
  }

  async function snapshot() {
    const page = await evaluate(pageSnapshotExpression());
    armIdle();
    return { ...page, events: events() };
  }

  async function snapshotResult() {
    const page = await snapshot();
    return {
      ok: true,
      browser: true,
      snapshot: page,
      content: formatBrowserSnapshot(page, page.events),
    };
  }

  async function action(prefix, expression) {
    const result = await evaluate(expression);
    if (!result?.ok) throw new Error(result?.error || 'The page did not perform that action.');
    await browserSleep(BROWSER_ACTION_PAUSE_MS);
    await waitForReady(3_000).catch(() => {});
    const page = await snapshot();
    return {
      ok: true,
      browser: true,
      snapshot: page,
      content: `${prefix}\n\n${formatBrowserSnapshot(page, page.events)}`,
    };
  }

  async function open(url, { entry = '', viewport = 'desktop' } = {}) {
    if (!browserUrlAllowed(url)) {
      throw new Error('The interactive browser only opens the local preview server.');
    }
    await close();
    const launched = await launchBrowser({ env, viewport, spawn, findBrowserImpl });
    const consoleEvents = [];
    const networkEvents = [];
    const requests = new Map();
    const record = (list, text) => {
      const value = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
      if (!value) return;
      list.push(value);
      while (list.length > BROWSER_MAX_EVENTS) list.shift();
    };

    launched.cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type !== 'error' && params.type !== 'warning') return;
      const text = (params.args ?? [])
        .map((arg) => arg.value ?? arg.description ?? arg.unserializableValue ?? '')
        .join(' ');
      record(consoleEvents, `${params.type}: ${text}`);
    });
    launched.cdp.on('Runtime.exceptionThrown', (params) => {
      record(
        consoleEvents,
        `exception: ${params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? 'unknown'}`,
      );
    });
    launched.cdp.on('Log.entryAdded', (params) => {
      if (!['error', 'warning'].includes(params.entry?.level)) return;
      record(consoleEvents, `${params.entry.level}: ${params.entry.text}`);
    });
    launched.cdp.on('Network.requestWillBeSent', (params) => {
      requests.set(params.requestId, {
        method: params.request?.method ?? 'GET',
        url: params.request?.url ?? '',
      });
    });
    launched.cdp.on('Network.responseReceived', (params) => {
      const status = Number(params.response?.status) || 0;
      if (status < 400) return;
      const request = requests.get(params.requestId) ?? {};
      record(networkEvents, `${status} ${request.method ?? 'GET'} ${request.url ?? params.response?.url ?? ''}`);
    });
    launched.cdp.on('Network.loadingFailed', (params) => {
      const request = requests.get(params.requestId) ?? {};
      record(networkEvents, `failed ${request.method ?? 'GET'} ${request.url ?? ''}: ${params.errorText ?? 'network error'}`);
    });
    launched.cdp.on('Page.javascriptDialogOpening', (params) => {
      record(consoleEvents, `dialog: ${params.type}: ${params.message || ''}`);
      launched.cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    });

    session = { ...launched, events: { console: consoleEvents, network: networkEvents }, entry };
    screenshots = 0;
    await launched.cdp.send('Page.navigate', { url });
    await waitForReady();
    await browserSleep(150);
    const page = await snapshot();
    return {
      ok: true,
      browser: true,
      entry,
      snapshot: page,
      content: `Opened the local preview /${entry || 'page'} in a headless browser.\n\n${formatBrowserSnapshot(page, page.events)}`,
    };
  }

  async function click(uid) {
    const safe = String(uid ?? '').trim();
    if (!/^e\d{1,3}$/.test(safe)) throw new Error('Use a uid such as e1 from browser_snapshot.');
    return action(
      `Clicked ${safe}.`,
      `(() => {
        const node = document.querySelector('[data-freeway-uid="${safe}"]');
        if (!node) return { ok: false, error: 'No element has uid ${safe}. Take a fresh browser_snapshot.' };
        node.scrollIntoView({ block: 'center', inline: 'center' });
        node.click();
        return { ok: true };
      })()`,
    );
  }

  async function type(uid, text, submit = false) {
    const safe = String(uid ?? '').trim();
    if (!/^e\d{1,3}$/.test(safe)) throw new Error('Use a uid such as e1 from browser_snapshot.');
    const value = String(text ?? '');
    return action(
      `Typed into ${safe}${submit ? ' and submitted' : ''}.`,
      `(() => {
        const node = document.querySelector('[data-freeway-uid="${safe}"]');
        if (!node) return { ok: false, error: 'No element has uid ${safe}. Take a fresh browser_snapshot.' };
        node.focus();
        if (node.isContentEditable) {
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, ${JSON.stringify(value)});
        } else if (node.tagName === 'SELECT') {
          node.value = ${JSON.stringify(value)};
          node.dispatchEvent(new Event('input', { bubbles: true }));
          node.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          const proto = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) setter.call(node, ${JSON.stringify(value)});
          else node.value = ${JSON.stringify(value)};
          node.dispatchEvent(new Event('input', { bubbles: true }));
          node.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (${submit ? 'true' : 'false'}) {
          if (node.form && typeof node.form.requestSubmit === 'function') node.form.requestSubmit();
          else node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        }
        return { ok: true };
      })()`,
    );
  }

  async function wait({ text = '', selector = '', timeoutMs = 5_000 } = {}) {
    const value = String(text ?? '');
    const css = String(selector ?? '');
    if (!value && !css) throw new Error('browser_wait needs text or a selector.');
    const limit = Math.min(Math.max(Number(timeoutMs) || 5_000, 200), 10_000);
    const deadline = Date.now() + limit;
    while (Date.now() < deadline) {
      const found = await evaluate(`(() => {
        const text = ${JSON.stringify(value)};
        const selector = ${JSON.stringify(css)};
        if (selector && !document.querySelector(selector)) return false;
        if (text && !(document.body?.innerText || '').includes(text)) return false;
        return true;
      })()`);
      if (found) {
        const page = await snapshot();
        return {
          ok: true,
          browser: true,
          snapshot: page,
          content: `Condition met.\n\n${formatBrowserSnapshot(page, page.events)}`,
        };
      }
      await browserSleep(150);
    }
    const page = await snapshot();
    return {
      ok: false,
      browser: true,
      snapshot: page,
      content: `Timed out after ${limit}ms waiting for ${value ? `text ${JSON.stringify(value)}` : `selector ${JSON.stringify(css)}`}.\n\n${formatBrowserSnapshot(page, page.events)}`,
    };
  }

  async function consoleLogs() {
    const list = events().console;
    if (!list.length) return { ok: true, content: 'Console: no warnings, errors or exceptions.' };
    return { ok: true, content: ['Console:', ...list.slice(-40).map((item) => `- ${item}`)].join('\n') };
  }

  async function networkLogs() {
    const list = events().network;
    if (!list.length) return { ok: true, content: 'Network: no failed, 4xx or 5xx requests.' };
    return {
      ok: true,
      content: ['Network problems:', ...list.slice(-40).map((item) => `- ${item}`)].join('\n'),
    };
  }

  async function screenshot() {
    if (!session) throw new Error('No browser session is open. Call browser_open first.');
    if (screenshots >= BROWSER_MAX_SHOTS) {
      throw new Error(`At most ${BROWSER_MAX_SHOTS} browser screenshots are allowed per session.`);
    }
    const shot = await session.cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const image = `data:image/png;base64,${shot.data}`;
    if (image.length > MAX_IMAGE_CHARS) {
      throw new Error('The browser screenshot is too large to send. Use browser_snapshot instead.');
    }
    const size = await evaluate('({ width: window.innerWidth, height: window.innerHeight })');
    screenshots += 1;
    armIdle();
    return {
      ok: true,
      browser: true,
      image,
      width: size?.width ?? 0,
      height: size?.height ?? 0,
      entry: session.entry || 'browser',
      content: `Captured the interactive browser at ${size?.width ?? '?'}×${size?.height ?? '?'}. Inspect layout and state; use browser_snapshot for text and errors.`,
    };
  }

  async function feedback({ reload = true } = {}) {
    if (!session) return null;
    if (reload) {
      await session.cdp.send('Page.reload', { ignoreCache: true });
      await waitForReady();
      await browserSleep(150);
    }
    const page = await snapshot();
    return {
      ok: true,
      browser: true,
      snapshot: page,
      content: formatBrowserSnapshot(page, page.events),
    };
  }

  async function close() {
    clearIdle();
    const current = session;
    session = null;
    screenshots = 0;
    if (!current) return;
    current.cdp.close();
    try {
      current.child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
    await browserSleep(250);
    try {
      if (current.child.exitCode === null) current.child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
    try {
      fs.rmSync(current.dir, { recursive: true, force: true });
    } catch {
      /* Windows may still hold the profile briefly */
    }
  }

  function closeSync() {
    clearIdle();
    const current = session;
    session = null;
    screenshots = 0;
    if (!current) return;
    try {
      current.cdp.close();
    } catch {
      /* already gone */
    }
    try {
      current.child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
    try {
      fs.rmSync(current.dir, { recursive: true, force: true });
    } catch {
      /* best effort while exiting */
    }
  }

  return {
    open,
    snapshot,
    snapshotResult,
    click,
    type,
    wait,
    console: consoleLogs,
    network: networkLogs,
    screenshot,
    feedback,
    close,
    closeSync,
    isOpen: () => Boolean(session),
    findBrowser: () => findBrowserImpl({ env }),
  };
}
