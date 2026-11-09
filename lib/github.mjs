// A tiny GitHub REST client. No SDK, no dependencies: one fetch wrapper and a
// curated set of endpoints for repository work, issues, pull requests, Actions,
// releases and search. Mutations are exposed as separate tools so the server can
// ask for approval before any of them runs.

const API = 'https://api.github.com';
const TIMEOUT_MS = 12_000;
const MAX_ITEMS = 20;
const MAX_BODY = 8_000;
const MAX_QUERY = 200;

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

function githubNumber(value, label = 'number') {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw badGithub(`A positive ${label} is required.`);
  }
  return number;
}

function githubBranchName(value) {
  const branch = String(value ?? '').trim();
  if (
    !branch ||
    branch.length > 200 ||
    !/^[A-Za-z0-9._/-]+$/.test(branch) ||
    branch.startsWith('-') ||
    branch.startsWith('/') ||
    branch.endsWith('/') ||
    branch.includes('//') ||
    branch.includes('..') ||
    branch.includes('@{')
  ) {
    throw badGithub('Use a valid branch name with letters, numbers, dot, underscore, slash or dash.');
  }
  return branch;
}

function githubPullHead(value) {
  const text = String(value ?? '').trim();
  const colon = text.indexOf(':');
  if (colon === -1) return githubBranchName(text);
  const owner = text.slice(0, colon);
  const branch = text.slice(colon + 1);
  if (!/^[A-Za-z0-9_.-]+$/.test(owner)) {
    throw badGithub('A pull request head is "branch" or "owner:branch".');
  }
  return `${owner}:${githubBranchName(branch)}`;
}

function githubSha(value) {
  const sha = String(value ?? '').trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw badGithub('A commit SHA is 7 to 40 hexadecimal characters.');
  return sha;
}

function githubQuery(value) {
  const query = String(value ?? '').trim();
  if (!query) throw badGithub('A search query is required.');
  return query.slice(0, MAX_QUERY);
}

function githubText(value, max = MAX_BODY) {
  return String(value ?? '').slice(0, max);
}

function githubBool(value) {
  return value === true;
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
      throw badGithub('GitHub is not connected. Connect it in the GitHub panel.');
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

    if (response.status === 204 || response.status === 205) return null;
    if (response.ok) return response.json().catch(() => ({}));

    const limited = rateLimitMessage(response);
    const detail = await response.json().catch(() => ({}));
    if (response.status === 401) {
      throw badGithub('GitHub rejected the token. Reconnect GitHub in the GitHub panel.', 401);
    }
    if (response.status === 404) {
      throw badGithub('That GitHub item was not found, or the token cannot see it.', 404);
    }
    if (response.status === 422) {
      throw badGithub(detail?.message ?? 'GitHub rejected that input.', 422);
    }
    throw badGithub(
      limited ?? detail?.message ?? `GitHub returned HTTP ${response.status}`,
      response.status === 403 ? 403 : 502,
    );
  }

  const pick = (list, map) => (Array.isArray(list) ? list : []).slice(0, MAX_ITEMS).map(map);
  const repoPath = (repoInput) => `/repos/${normalizeRepo(repoInput)}`;

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
      defaultBranch: repo.default_branch ?? null,
      htmlUrl: repo.html_url ?? null,
    }));
  }

  async function repo(repoInput) {
    const item = await call(repoPath(repoInput));
    return {
      fullName: item.full_name,
      private: Boolean(item.private),
      description: String(item.description ?? '').slice(0, 200),
      defaultBranch: item.default_branch ?? 'main',
      htmlUrl: item.html_url ?? null,
      owner: item.owner?.login ?? null,
      permissions: {
        push: Boolean(item.permissions?.push),
        admin: Boolean(item.permissions?.admin),
      },
    };
  }

  async function branches(repoInput) {
    const list = await call(`${repoPath(repoInput)}/branches?per_page=20`);
    return pick(list, (item) => ({
      name: item.name,
      protected: Boolean(item.protected),
      sha: String(item.commit?.sha ?? '').slice(0, 7),
    }));
  }

  async function issues(repoInput, state = 'open') {
    const repo = normalizeRepo(repoInput);
    const list = await call(`${repoPath(repo)}/issues?state=${state}&per_page=20`);
    // The issues endpoint also returns pull requests; the panel shows them apart.
    return pick(
      list.filter((item) => !item.pull_request),
      (item) => ({
        number: item.number,
        title: item.title,
        state: item.state,
        comments: item.comments ?? 0,
        labels: (item.labels ?? []).map((label) => (typeof label === 'string' ? label : label.name)).slice(0, 8),
        updatedAt: item.updated_at ?? null,
        url: item.html_url,
      }),
    );
  }

  async function issue(repoInput, number) {
    const item = await call(`${repoPath(repoInput)}/issues/${githubNumber(number)}`);
    return {
      number: item.number,
      title: item.title,
      state: item.state,
      body: githubText(item.body),
      comments: item.comments ?? 0,
      labels: (item.labels ?? []).map((label) => (typeof label === 'string' ? label : label.name)).slice(0, 8),
      user: item.user?.login ?? null,
      url: item.html_url,
      createdAt: item.created_at ?? null,
    };
  }

  async function createIssue(repoInput, title, body) {
    const repo = normalizeRepo(repoInput);
    const cleanTitle = String(title ?? '').trim().slice(0, 200);
    if (!cleanTitle) throw badGithub('An issue needs a title.');
    const item = await call(`${repoPath(repo)}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title: cleanTitle, body: githubText(body) }),
    });
    return { number: item.number, title: item.title, url: item.html_url };
  }

  async function updateIssue(repoInput, number, changes = {}) {
    const payload = {};
    if (changes.state !== undefined) {
      if (changes.state !== 'open' && changes.state !== 'closed') {
        throw badGithub('Issue state must be open or closed.');
      }
      payload.state = changes.state;
    }
    if (changes.labels !== undefined) {
      if (!Array.isArray(changes.labels)) throw badGithub('Labels must be a list.');
      payload.labels = changes.labels
        .map((label) => String(label).trim().slice(0, 50))
        .filter(Boolean)
        .slice(0, 20);
    }
    if (Object.keys(payload).length === 0) throw badGithub('Name a state or at least one label.');
    const item = await call(`${repoPath(repoInput)}/issues/${githubNumber(number)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return { number: item.number, state: item.state, labels: payload.labels ?? [], url: item.html_url };
  }

  async function comment(repoInput, number, body) {
    const text = String(body ?? '').trim();
    if (!text) throw badGithub('A comment needs text.');
    const item = await call(`${repoPath(repoInput)}/issues/${githubNumber(number)}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: githubText(text) }),
    });
    return { id: item.id, url: item.html_url, createdAt: item.created_at ?? null };
  }

  async function comments(repoInput, number) {
    const list = await call(`${repoPath(repoInput)}/issues/${githubNumber(number)}/comments?per_page=20`);
    return pick(list, (item) => ({
      id: item.id,
      user: item.user?.login ?? null,
      body: githubText(item.body),
      createdAt: item.created_at ?? null,
      url: item.html_url,
    }));
  }

  async function pulls(repoInput, state = 'open') {
    const repo = normalizeRepo(repoInput);
    const list = await call(`${repoPath(repo)}/pulls?state=${state}&per_page=20`);
    return pick(list, (item) => ({
      number: item.number,
      title: item.title,
      state: item.state,
      draft: Boolean(item.draft),
      merged: Boolean(item.merged_at),
      user: item.user?.login ?? null,
      updatedAt: item.updated_at ?? null,
      url: item.html_url,
    }));
  }

  async function pull(repoInput, number) {
    const item = await call(`${repoPath(repoInput)}/pulls/${githubNumber(number)}`);
    return {
      number: item.number,
      title: item.title,
      state: item.state,
      draft: Boolean(item.draft),
      merged: Boolean(item.merged),
      mergeable: item.mergeable ?? null,
      body: githubText(item.body),
      user: item.user?.login ?? null,
      head: item.head?.ref ?? null,
      base: item.base?.ref ?? null,
      changedFiles: item.changed_files ?? 0,
      additions: item.additions ?? 0,
      deletions: item.deletions ?? 0,
      url: item.html_url,
    };
  }

  async function createPull(repoInput, options = {}) {
    const title = String(options.title ?? '').trim().slice(0, 200);
    if (!title) throw badGithub('A pull request needs a title.');
    const head = githubPullHead(options.head);
    const base = githubBranchName(options.base);
    const item = await call(`${repoPath(repoInput)}/pulls`, {
      method: 'POST',
      body: JSON.stringify({
        title,
        head,
        base,
        body: githubText(options.body),
        draft: githubBool(options.draft),
      }),
    });
    return { number: item.number, title: item.title, url: item.html_url };
  }

  async function reviews(repoInput, number) {
    const list = await call(`${repoPath(repoInput)}/pulls/${githubNumber(number)}/reviews?per_page=20`);
    return pick(list, (item) => ({
      id: item.id,
      user: item.user?.login ?? null,
      state: item.state,
      body: githubText(item.body),
      submittedAt: item.submitted_at ?? null,
      url: item.html_url,
    }));
  }

  async function reviewPull(repoInput, number, options = {}) {
    const event = String(options.event ?? '').trim().toUpperCase();
    if (!['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(event)) {
      throw badGithub('A review event must be APPROVE, REQUEST_CHANGES or COMMENT.');
    }
    const body = String(options.body ?? '').trim();
    if (event !== 'APPROVE' && !body) {
      throw badGithub('A review with changes requested or a comment needs a body.');
    }
    const payload = { event };
    if (body) payload.body = githubText(body);
    const item = await call(`${repoPath(repoInput)}/pulls/${githubNumber(number)}/reviews`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return { id: item.id, state: item.state, url: item.html_url };
  }

  async function mergePull(repoInput, number, options = {}) {
    const method = String(options.method ?? 'merge').toLowerCase();
    if (!['merge', 'squash', 'rebase'].includes(method)) {
      throw badGithub('Merge method must be merge, squash or rebase.');
    }
    const item = await call(`${repoPath(repoInput)}/pulls/${githubNumber(number)}/merge`, {
      method: 'PUT',
      body: JSON.stringify({
        merge_method: method,
        ...(options.body ? { commit_title: githubText(options.body, 200) } : {}),
        ...(options.deleteBranch === true ? { delete_branch: true } : {}),
      }),
    });
    return {
      merged: Boolean(item.merged),
      message: String(item.message ?? ''),
      sha: item.sha ? String(item.sha).slice(0, 7) : null,
    };
  }

  async function commits(repoInput, branch) {
    const repo = normalizeRepo(repoInput);
    const ref = branch ? `&sha=${encodeURIComponent(githubBranchName(branch))}` : '';
    const list = await call(`${repoPath(repo)}/commits?per_page=20${ref}`);
    return pick(list, (item) => ({
      sha: String(item.sha ?? '').slice(0, 7),
      message: String(item.commit?.message ?? '').split('\n')[0].slice(0, 120),
      author: item.commit?.author?.name ?? item.author?.login ?? 'unknown',
      date: item.commit?.author?.date ?? null,
      url: item.html_url ?? null,
    }));
  }

  async function commit(repoInput, sha) {
    const item = await call(`${repoPath(repoInput)}/commits/${githubSha(sha)}`);
    return {
      sha: String(item.sha ?? '').slice(0, 7),
      message: String(item.commit?.message ?? '').slice(0, 2_000),
      author: item.commit?.author?.name ?? item.author?.login ?? 'unknown',
      date: item.commit?.author?.date ?? null,
      stats: item.stats ?? null,
      files: (item.files ?? []).slice(0, 20).map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
      })),
      url: item.html_url ?? null,
    };
  }

  async function workflows(repoInput) {
    const list = await call(`${repoPath(repoInput)}/actions/workflows?per_page=20`);
    return (Array.isArray(list?.workflows) ? list.workflows : []).slice(0, MAX_ITEMS).map((item) => ({
      id: item.id,
      name: item.name,
      path: item.path,
      state: item.state,
      url: item.html_url,
    }));
  }

  async function workflowRuns(repoInput) {
    const result = await call(`${repoPath(repoInput)}/actions/runs?per_page=20`);
    return (Array.isArray(result?.workflow_runs) ? result.workflow_runs : []).slice(0, MAX_ITEMS).map((item) => ({
      id: item.id,
      name: item.name,
      number: item.run_number,
      status: item.status,
      conclusion: item.conclusion,
      event: item.event,
      branch: item.head_branch,
      url: item.html_url,
      createdAt: item.created_at,
    }));
  }

  function workflowId(value) {
    const text = String(value ?? '').trim();
    if (/^[1-9][0-9]{0,19}$/.test(text)) return text;
    if (/^[A-Za-z0-9._-]+\.ya?ml$/.test(text)) return text;
    throw badGithub('A workflow is a numeric id or a file name such as ci.yml.');
  }

  async function dispatchWorkflow(repoInput, options = {}) {
    const id = workflowId(options.workflowId);
    const ref = githubBranchName(options.ref);
    const inputs = {};
    if (options.inputs && typeof options.inputs === 'object' && !Array.isArray(options.inputs)) {
      for (const [key, value] of Object.entries(options.inputs).slice(0, 20)) {
        if (/^[A-Za-z0-9_-]{1,64}$/.test(key)) inputs[key] = String(value).slice(0, 500);
      }
    }
    await call(`${repoPath(repoInput)}/actions/workflows/${encodeURIComponent(id)}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref, ...(Object.keys(inputs).length ? { inputs } : {}) }),
    });
    return { ok: true, workflow: id, ref };
  }

  async function rerunWorkflow(repoInput, runId) {
    await call(`${repoPath(repoInput)}/actions/runs/${githubNumber(runId, 'run id')}/rerun`, { method: 'POST' });
    return { ok: true, runId: githubNumber(runId, 'run id') };
  }

  async function cancelWorkflow(repoInput, runId) {
    await call(`${repoPath(repoInput)}/actions/runs/${githubNumber(runId, 'run id')}/cancel`, { method: 'POST' });
    return { ok: true, runId: githubNumber(runId, 'run id') };
  }

  async function releases(repoInput) {
    const list = await call(`${repoPath(repoInput)}/releases?per_page=20`);
    return pick(list, (item) => ({
      id: item.id,
      tag: item.tag_name,
      name: item.name,
      draft: Boolean(item.draft),
      prerelease: Boolean(item.prerelease),
      publishedAt: item.published_at ?? null,
      url: item.html_url,
    }));
  }

  async function createRelease(repoInput, options = {}) {
    const tag = String(options.tag ?? '').trim();
    if (!/^[A-Za-z0-9._/-]{1,100}$/.test(tag) || tag.includes('..')) {
      throw badGithub('A release needs a valid tag name.');
    }
    const item = await call(`${repoPath(repoInput)}/releases`, {
      method: 'POST',
      body: JSON.stringify({
        tag_name: tag,
        name: String(options.name ?? tag).trim().slice(0, 200),
        body: githubText(options.body),
        draft: githubBool(options.draft),
        prerelease: githubBool(options.prerelease),
      }),
    });
    return { id: item.id, tag: item.tag_name, url: item.html_url };
  }

  async function createRepo(options = {}) {
    const name = String(options.name ?? '').trim();
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(name) || name === '.' || name === '..') {
      throw badGithub('A repository name uses letters, numbers, dot, underscore or dash.');
    }
    const item = await call('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name,
        private: options.private !== false,
        description: String(options.description ?? '').slice(0, 350),
        auto_init: true,
      }),
    });
    return {
      fullName: item.full_name,
      private: Boolean(item.private),
      defaultBranch: item.default_branch ?? 'main',
      url: item.html_url,
    };
  }

  async function search(queryInput, typeInput = 'repos') {
    const query = githubQuery(queryInput);
    const type = String(typeInput ?? 'repos').toLowerCase();
    if (!['repos', 'issues', 'code'].includes(type)) {
      throw badGithub('Search type must be repos, issues or code.');
    }
    const endpoint = type === 'repos' ? 'repositories' : type;
    const result = await call(`/search/${endpoint}?q=${encodeURIComponent(query)}&per_page=20`);
    const items = Array.isArray(result?.items) ? result.items.slice(0, MAX_ITEMS) : [];
    return {
      type,
      total: Number(result?.total_count ?? items.length),
      items: items.map((item) => {
        if (type === 'repos') {
          return { fullName: item.full_name, description: String(item.description ?? '').slice(0, 160), url: item.html_url };
        }
        if (type === 'issues') {
          return { number: item.number, title: item.title, state: item.state, url: item.html_url };
        }
        return { repo: item.repository?.full_name ?? null, path: item.path, url: item.html_url };
      }),
    };
  }

  return {
    hasToken: Boolean(token),
    viewer,
    repos,
    repo,
    branches,
    issues,
    issue,
    createIssue,
    updateIssue,
    comment,
    comments,
    pulls,
    pull,
    createPull,
    reviews,
    reviewPull,
    mergePull,
    commits,
    commit,
    workflows,
    workflowRuns,
    dispatchWorkflow,
    rerunWorkflow,
    cancelWorkflow,
    releases,
    createRelease,
    createRepo,
    search,
  };
}
