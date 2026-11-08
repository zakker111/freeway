// A tiny static site, generated from data rather than a model-written blob.
// The three files are deliberately boring: no build step, no package manager
// and no network requests, so the local preview can open them immediately.

const THEMES = {
  midnight: {
    scheme: 'dark',
    bg: '#0b0e13',
    panel: '#141a22',
    panel2: '#1b222c',
    text: '#eef3f7',
    muted: '#9aa8b7',
    line: '#2a3542',
    accent: '#8ee6b4',
    ink: '#07130c',
    glow: 'rgba(142, 230, 180, .16)',
  },
  paper: {
    scheme: 'light',
    bg: '#f3f0e8',
    panel: '#fffdf8',
    panel2: '#f8f4eb',
    text: '#252118',
    muted: '#6f6759',
    line: '#ddd5c5',
    accent: '#1f6f4a',
    ink: '#fbfffc',
    glow: 'rgba(31, 111, 74, .12)',
  },
  sunset: {
    scheme: 'dark',
    bg: '#1a0f12',
    panel: '#2a171b',
    panel2: '#361e23',
    text: '#fff2ee',
    muted: '#c6a6a0',
    line: '#4a2b31',
    accent: '#ffb17a',
    ink: '#2b1408',
    glow: 'rgba(255, 177, 122, .16)',
  },
};

const MAX_FOLDER = 120;

function scaffoldText(value, limit, fallback) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
  return text || fallback;
}

function cleanFolder(value) {
  const raw = String(value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  if (!raw) return '';
  if (raw.length > MAX_FOLDER) throw new Error(`Folder is too long (${MAX_FOLDER} characters max).`);
  const parts = raw.split('/');
  if (
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        part.startsWith('.') ||
        part.includes('\0'),
    )
  ) {
    throw new Error('Choose a plain folder name without "." or ".." segments.');
  }
  return parts.join('/');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The paths scaffold_project would create, without generating any content. */
export function scaffoldLayout(input = {}) {
  const folder = cleanFolder(input?.folder);
  const prefix = folder ? `${folder}/` : '';
  const paths = ['index.html', 'styles.css', 'app.js'].map((name) => `${prefix}${name}`);
  return {
    folder,
    entry: paths[0],
    paths,
  };
}

/** Build the complete site in memory. Nothing is written here. */
export function buildScaffold(input = {}) {
  const layout = scaffoldLayout(input);
  const title = scaffoldText(input.title, 80, 'A small site');
  const tagline = scaffoldText(
    input.tagline,
    180,
    'A clean starting point, ready for your own words and ideas.',
  );
  const themeName = Object.hasOwn(THEMES, input.theme) ? input.theme : 'midnight';
  const theme = THEMES[themeName];
  const safeTitle = escapeHtml(title);
  const safeTagline = escapeHtml(tagline);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="${theme.scheme}" />
  <meta name="description" content="${safeTagline}" />
  <title>${safeTitle}</title>
  <link rel="stylesheet" href="./styles.css" />
  <script src="./app.js" defer></script>
</head>
<body>
  <div class="page">
    <header class="topbar">
      <a class="brand" href="./index.html" aria-label="${safeTitle} home">
        <span class="mark" aria-hidden="true"></span>${safeTitle}
      </a>
      <span class="badge">Static site</span>
    </header>

    <main>
      <section class="hero" aria-labelledby="hero-title">
        <p class="eyebrow">Made with Freeway</p>
        <h1 id="hero-title">${safeTitle}</h1>
        <p class="lead">${safeTagline}</p>
        <div class="actions">
          <button class="button" id="cta" type="button">Try the button</button>
          <a class="quiet" href="#details">Read more</a>
        </div>
        <p class="note" id="note" role="status" aria-live="polite">This page is ready to edit.</p>
      </section>

      <section class="details" id="details" aria-label="About this starter">
        <article>
          <span class="number">01</span>
          <h2>One folder</h2>
          <p>Everything lives together here, with no install step and no hidden build output.</p>
        </article>
        <article>
          <span class="number">02</span>
          <h2>Three files</h2>
          <p>Edit the HTML for structure, the stylesheet for the look, and the script for behaviour.</p>
        </article>
        <article>
          <span class="number">03</span>
          <h2>Preview first</h2>
          <p>Open the Preview panel to see the page. Check it again after each change.</p>
        </article>
      </section>
    </main>

    <footer>
      <span>Built in Freeway</span>
      <span>Edit this page and make it yours.</span>
    </footer>
  </div>
</body>
</html>
`;

  const css = `:root {
  color-scheme: ${theme.scheme};
  --bg: ${theme.bg};
  --panel: ${theme.panel};
  --panel-2: ${theme.panel2};
  --text: ${theme.text};
  --muted: ${theme.muted};
  --line: ${theme.line};
  --accent: ${theme.accent};
  --ink: ${theme.ink};
  --glow: ${theme.glow};
  --radius: 18px;
}

* { box-sizing: border-box; }

html { scroll-behavior: smooth; }

body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(900px 520px at 82% -10%, var(--glow), transparent 65%),
    var(--bg);
  color: var(--text);
  font-family: "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  line-height: 1.6;
}

a { color: inherit; }

.page {
  width: min(1080px, calc(100% - 40px));
  margin: 0 auto;
  padding: 28px 0 42px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 28px;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--text);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: .02em;
  text-decoration: none;
}

.mark {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  background: var(--accent);
  box-shadow: 0 0 0 5px var(--glow);
}

.badge {
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 5px 11px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.hero {
  max-width: 760px;
  padding: clamp(42px, 9vw, 92px) 0 clamp(50px, 8vw, 82px);
}

.eyebrow {
  margin: 0 0 14px;
  color: var(--accent);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: .16em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  max-width: 900px;
  font-size: clamp(44px, 9vw, 88px);
  font-weight: 700;
  letter-spacing: -.055em;
  line-height: .98;
}

.lead {
  max-width: 590px;
  margin: 28px 0 0;
  color: var(--muted);
  font-size: clamp(17px, 2.2vw, 21px);
}

.actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 18px;
  margin-top: 30px;
}

.button {
  border: 0;
  border-radius: 999px;
  padding: 12px 22px;
  background: var(--accent);
  color: var(--ink);
  cursor: pointer;
  font: inherit;
  font-weight: 800;
}

.button:hover { filter: brightness(1.06); }
.button:focus-visible, .quiet:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }

.quiet {
  color: var(--muted);
  font-size: 14px;
  text-underline-offset: 4px;
}

.note {
  min-height: 1.6em;
  margin: 20px 0 0;
  color: var(--muted);
  font-size: 13px;
}

.note.is-live { color: var(--accent); }

.details {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  padding-top: 28px;
  border-top: 1px solid var(--line);
}

.details article {
  min-height: 190px;
  padding: 22px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: linear-gradient(145deg, var(--panel), var(--panel-2));
}

.number {
  color: var(--accent);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: .1em;
}

h2 {
  margin: 26px 0 8px;
  font-size: 20px;
  letter-spacing: -.02em;
}

.details p, footer {
  color: var(--muted);
  font-size: 14px;
}

.details p { margin: 0; }

footer {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: 44px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
}

@media (max-width: 740px) {
  .details { grid-template-columns: 1fr; }
  .details article { min-height: 0; }
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
}
`;

  const js = `const button = document.querySelector("#cta");
const note = document.querySelector("#note");

if (button && note) {
  button.addEventListener("click", () => {
    note.textContent = "It works. Edit index.html, styles.css or app.js next.";
    note.classList.add("is-live");
  });
}
`;

  return {
    ...layout,
    title,
    tagline,
    theme: themeName,
    files: [
      { path: layout.paths[0], content: html },
      { path: layout.paths[1], content: css },
      { path: layout.paths[2], content: js },
    ],
  };
}
