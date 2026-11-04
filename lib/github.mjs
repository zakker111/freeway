// A tiny GitHub REST client. No SDK, no dependencies: one fetch wrapper and a
// handful of endpoints, each trimmed to what the rail and the model need.

const API = 'https://api.github.com';
const TIMEOUT_MS = 12_000;
const MAX_ITEMS = 20;

// Not named fail(): tools.mjs already has a top-level fail(), and the single
// file build concatenates every module into one scope.
function badGithub(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function normalizeRepo(value) {
  const text = String(value ?? '').trim();
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(text);
  if (!match) throw badGithub('A repository is "owner/name", for example zakker111/freeway.');
  return `${match[1]}/${match[2]}`;
}

function rateLimitMessage(response) {
  if (response.headers.get('x-ratelimit-remaining') !== '0') return null;
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  const when =
    Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString().slice(11, 19) : 'soon';
  return `GitHub's API rate limit is exhausted; it resets at ${when} UTC.`;
}

export function createGithub(tokenInput, options = {}) {
  const token = typeof tokenInput === 'string' ? tokenInput.trim() : '';
  const request = options.fetch ?? fetch;
  const api = options.api ?? API;

  async function call(pathname, init = {}) {
    if (!token) {
      throw badGithub('No GitHub token is saved. Add one named GITHUB_TOKEN in the Secrets panel.');
    }

    let response;
    try {
      response = await request(`${api}${pathname}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'Freeway (local app)',
          'content-type': 'application/json',
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw badGithub(`GitHub did not answer: ${error?.message ?? error}`, 502);
    }

    if (response.ok) return response.json().catch(() => ({}));

    const limited = rateLimitMessage(response);
    const detail = await response.json().catch(() => ({}));
    if (response.status === 401) {
      throw badGithub('GitHub rejected the token. Check GITHUB_TOKEN in the Secrets panel.', 401);
    }
    if (response.status === 404) {
      throw badGithub('That repository was not found, or the token cannot see it.', 404);
    }
    throw badGithub(
      limited ?? detail?.message ?? `GitHub returned HTTP ${response.status}`,
      response.status === 403 ? 403 : 502,
    );
  }

  const pick = (list, map) => (Array.isArray(list) ? list : []).slice(0, MAX_ITEMS).map(map);

  async function viewer() {
    const me = await call('/user');
    return { login: me.login ?? 'unknown', name: me.name ?? null };
  }

  async function repos() {
    const list = await call('/user/repos?per_page=20&sort=updated');
    return pick(list, (repo) => ({
      fullName: repo.full_name,
      private: Boolean(repo.private),
      description: String(repo.description ?? '').slice(0, 120),
      updatedAt: repo.updated_at ?? null,
    }));
  }

  async function issues(repoInput, state = 'open') {
    const repo = normalizeRepo(repoInput);
    const list = await call(`/repos/${repo}/issues?state=${state}&per_page=20`);
    // The issues endpoint also returns pull requests; the panel shows them apart.
    return pick(
      list.filter((item) => !item.pull_request),
      (item) => ({
        number: item.number,
        title: item.title,
        state: item.state,
        comments: item.comments ?? 0,
        updatedAt: item.updated_at ?? null,
        url: item.html_url,
      }),
    );
  }

  async function pulls(repoInput, state = 'open') {
    const repo = normalizeRepo(repoInput);
    const list = await call(`/repos/${repo}/pulls?state=${state}&per_page=20`);
    return pick(list, (item) => ({
      number: item.number,
      title: item.title,
      state: item.state,
      draft: Boolean(item.draft),
      updatedAt: item.updated_at ?? null,
      url: item.html_url,
    }));
  }

  async function commits(repoInput) {
    const repo = normalizeRepo(repoInput);
    const list = await call(`/repos/${repo}/commits?per_page=10`);
    return pick(list, (item) => ({
      sha: String(item.sha ?? '').slice(0, 7),
      message: String(item.commit?.message ?? '').split('\n')[0].slice(0, 120),
      author: item.commit?.author?.name ?? item.author?.login ?? 'unknown',
      date: item.commit?.author?.date ?? null,
    }));
  }

  async function createIssue(repoInput, title, body) {
    const repo = normalizeRepo(repoInput);
    const cleanTitle = String(title ?? '').trim().slice(0, 200);
    if (!cleanTitle) throw badGithub('An issue needs a title.');
    const issue = await call(`/repos/${repo}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title: cleanTitle, body: String(body ?? '').slice(0, 8000) }),
    });
    return { number: issue.number, title: issue.title, url: issue.html_url };
  }

  return { hasToken: Boolean(token), viewer, repos, issues, pulls, commits, createIssue };
}
