# Freeway project page on GitHub Pages

This folder is a static landing page. GitHub Pages can host it directly; it cannot run the
Freeway Node server or the Cloudflare Worker. The app itself stays at its hosted cloud URL
and in the desktop release.

The page uses only `index.html`, `404.html`, `icon.svg`, `og.png`, and `.nojekyll`. There is no build step and no
JavaScript requirement.

## What is ready

- `index.html` — responsive landing page with links to the live cloud app, latest release,
  source, security, and privacy.
- `icon.svg` — the Chatty app icon.
- `404.html` — a self-contained not-found page so a mistyped URL still lands somewhere useful.
- `og.png` — the 1200×630 social card behind `og:image` and `twitter:image`.
- `.nojekyll` — tells GitHub Pages to serve the files exactly as written instead of running
  Jekyll.

## Publish it

### 1. Commit and push

From the repository root:

```bash
git add docs
git commit -m "docs: add GitHub Pages landing page"
git push origin main
```

### 2. Enable Pages

1. Open <https://github.com/zakker111/freeway/settings/pages>.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Choose **Branch: `main`** and **Folder: `/docs`**.
4. Press **Save**.

GitHub Pages will build the folder after every push to `main`.

### 3. Open the site

The project URL is:

<https://zakker111.github.io/freeway/>

The first build can take a minute. Check the **Actions** tab if the Pages build fails.

> The repository is public, and Pages publishes from `main` → `/docs` after each push.
> The site is live at <https://zakker111.github.io/freeway/>.

## Verify it

Run these after the site is live:

```bash
curl -I https://zakker111.github.io/freeway/
curl -I https://zakker111.github.io/freeway/icon.svg
```

Expected: both return `HTTP/2 200`. Open the page and check:

- the Chatty icon loads;
- **Open cloud app** reaches the live cloud edition;
- **Download desktop** reaches the latest GitHub release;
- source, security, and privacy links resolve;
- the layout works at phone width and desktop width.

## Update it

Edit `docs/index.html`, `docs/404.html` or replace `docs/icon.svg`, then push to `main`. Pages
republishes the branch automatically. No workflow file is needed.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Settings has no `/docs` option | Confirm **Pages → Build and deployment → Source** is set to **Deploy from a branch**, branch `main`, folder `/docs`. |
| `404` after enabling | Wait for the first Pages build, then confirm the source is `main` / `/docs`. |
| Icon is missing | Confirm `docs/icon.svg` was committed and the page uses `./icon.svg`. |
| Styling is missing | The page's CSS is inline; check that `index.html` itself was committed, not only the README. |
| Cloud app link fails | Verify the production URL in `index.html`; Pages does not host the app. |

## Important boundary

GitHub Pages is a static host. It cannot execute `app.mjs`, serve the Cloudflare Worker, or
provide the desktop Files/command features. Do not move the app runtime into `docs/`; keep
this page as the public project/download page and link to the hosted app.
