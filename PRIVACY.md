# Privacy

Freeway is local-first. The desktop edition has no accounts, analytics, advertising or
telemetry. It contacts only the model provider you select (and a URL you explicitly ask
it to fetch).

## Hosted cloud edition

The hosted edition is **guest-only**. There is no sign-in, no Freebuff account, and no
server-side chat history.

### What stays in your browser

- **Chats and prompt library** are stored in this browser's `localStorage`.
- **Workspace files** are stored in this browser's IndexedDB, scoped to the open chat.
- **Settings and preferences** are stored in `localStorage`.
- **Chatty's preference and seen marker** are stored in `localStorage`. Chatty is a local
  UI companion: it does not read chats, keys or workspace files, and it makes no network
  requests.
- **Provider keys and a GitHub token** are stored in this tab's `sessionStorage` and
  disappear when the tab closes. They are sent only to the provider or to GitHub.
- A service worker caches the app shell so the page can load quickly.

Clearing this site's browser data removes those chats, files, settings and tab keys.
Browser storage is not a backup; export anything you want to keep.

### What the cloud service receives

When you send a message, the Worker receives the conversation text, the selected
provider and model, and any browser-file text you explicitly attach. It forwards that
request to the selected provider, using either the deployment's provider key or the key
you supplied in the page. The provider's own privacy terms apply to that request.

The Worker does not write chats or workspace files to a database. It does not return
provider keys to the page.

### Shared-key limits and IP addresses

If the deployment uses its own provider key, the Worker enforces a daily per-visitor
limit. A Cloudflare D1 table named `budget` stores the UTC day, the
`CF-Connecting-IP` address, and a request count for that day. The Worker also keeps a
short-lived in-memory table of IP addresses and request times for its per-minute rate
limit. These records are used only for abuse prevention and quota enforcement.

Cloudflare, as the hosting provider, also processes request metadata such as IP
addresses, timestamps and URLs under its own policies. The app adds no third-party
analytics, advertising or tracking scripts.

### GitHub panel

If you save a GitHub token, the browser calls `https://api.github.com` directly. The
token is not sent to the Freeway Worker and is not stored on the server.

## Questions

For a non-sensitive privacy question, open an issue at
<https://github.com/zakker111/freeway/issues>. For a security report, follow
[SECURITY.md](SECURITY.md) and do not post sensitive details publicly.

_Last updated: 10 November 2026._
