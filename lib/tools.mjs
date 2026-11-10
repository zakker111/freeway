// Tools the model can call. Everything runs in this process with no
// dependencies; file access goes through the sandboxed workspace the caller
// passes in, and network access is limited to public http(s).

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { parseTestOutput } from './testparse.mjs';
import { buildScaffold } from './scaffold.mjs';
import { checkPreview } from './preview-check.mjs';
import { gitStatus, gitDiff, gitCommit, gitRevert, gitHistory } from './git.mjs';
import { inspectProject, formatProjectInfo, resolveCheck, parseCheckOutput } from './project.mjs';
import { buildChartHtml } from './chart.mjs';

const MAX_EXPRESSION = 200;
const MAX_FETCH_CHARS = 20_000;
const MAX_FETCH_BYTES = 200_000;
const FETCH_TIMEOUT_MS = 8_000;
const DNS_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 5;

import { normalizePlan, planToMarkdown } from './plan.mjs';

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description:
        'Return the current date, time and weekday. Use it for anything time- or date-dependent instead of guessing.',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'Optional IANA timezone such as Europe/Berlin. Defaults to this computer timezone.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description:
        'Evaluate an arithmetic expression exactly. Supports + - * / % ^, parentheses and decimals. Use it instead of doing mental arithmetic.',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'For example (1250 * 3) / 7' },
        },
        required: ['expression'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description:
        'Fetch a public web page and return its readable text. Scripts and styling are stripped. Private and local addresses are refused.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Absolute http(s) URL' },
        },
        required: ['url'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description:
        'List the files and folders inside the workspace folder. Use it to find out what a project contains before reading anything.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Folder inside the workspace, relative to its root. Defaults to the root.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read a text file from the workspace folder. Files over 256 KB and binary files are refused.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to the workspace root.' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description:
        'Search for text across the workspace, like grep. Returns path, line number and the matching line. Generated folders such as node_modules, dist and .git are skipped, and results are capped. Use this to find where something is defined or used before reading files.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to find, or a regular expression when regex is true.' },
          path: {
            type: 'string',
            description: 'Folder or file to search, relative to the workspace root. Defaults to the root.',
          },
          regex: { type: 'boolean', description: 'Treat query as a JavaScript regular expression.' },
          caseSensitive: { type: 'boolean', description: 'Match case exactly. Defaults to false.' },
          maxResults: { type: 'integer', description: 'Maximum matches to return, 1-80. Defaults to 40.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_many',
      description:
        'Read several workspace files in one call, up to 8 files and 320 KB in total. Per-file errors are reported instead of failing the whole batch. Use it after search_files to load the relevant files together.',
      parameters: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'File paths relative to the workspace root, at most 8.',
          },
        },
        required: ['paths'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_list',
      description:
        'Read GitHub repositories, repository details, branches, issues, one issue, pull requests, one pull, commits, one commit, reviews, comments, Actions workflows, Action runs or releases. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          what: {
            type: 'string',
            enum: [
              'repos', 'repo', 'branches', 'issues', 'issue', 'pulls', 'pull', 'commits', 'commit',
              'reviews', 'comments', 'workflows', 'runs', 'releases',
            ],
            description: 'What to read. Defaults to repos.',
          },
          repo: { type: 'string', description: 'owner/name, required for repository-specific views.' },
          number: { type: 'integer', description: 'Issue, pull request or review number, where relevant.' },
          sha: { type: 'string', description: 'Commit SHA for the commit view.' },
          branch: { type: 'string', description: 'Optional branch for the commits view.' },
          state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Issue and pull state, default open.' },
        },
        required: ['what'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_create_issue',
      description:
        'Open an issue on a repository. The user approves every issue before it is created, so state the title and body clearly.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'owner/name' },
          title: { type: 'string', description: 'Issue title, one line.' },
          body: { type: 'string', description: 'Issue body in markdown.' },
        },
        required: ['repo', 'title'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_clone',
      description:
        'Clone a GitHub repository into the workspace so you can inspect and work on its code. The clone is shallow (latest commit), is refused if the folder already exists, and the user approves every clone.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'owner/name' },
          folder: {
            type: 'string',
            description: 'One new folder name inside the workspace; defaults to the repository name.',
          },
        },
        required: ['repo'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_update_issue',
      description:
        'Close, reopen or relabel an issue. The user approves every change, so state the intended result clearly.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'owner/name' },
          number: { type: 'integer', description: 'Issue number.' },
          state: { type: 'string', enum: ['open', 'closed'], description: 'Optional new state.' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Optional replacement labels.' },
        },
        required: ['repo', 'number'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_comment',
      description:
        'Comment on an issue or pull request. The user approves every comment before it is posted.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'owner/name' },
          number: { type: 'integer', description: 'Issue or pull request number.' },
          body: { type: 'string', description: 'Comment text in markdown.' },
        },
        required: ['repo', 'number', 'body'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_create_pull',
      description:
        'Open a pull request from a head branch into a base branch. Push the head branch first if it only exists locally. The user approves every pull request.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'owner/name' },
          title: { type: 'string', description: 'Pull request title, one line.' },
          head: { type: 'string', description: 'Source branch, or owner:branch for a fork.' },
          base: { type: 'string', description: 'Target branch, for example main.' },
          body: { type: 'string', description: 'Pull request body in markdown.' },
          draft: { type: 'boolean', description: 'Open as a draft.' },
        },
        required: ['repo', 'title', 'head', 'base'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_review_pull',
      description:
        'Submit a pull request review: approve, request changes or comment. The user approves every review.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'owner/name' },
          number: { type: 'integer', description: 'Pull request number.' },
          event: { type: 'string', enum: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'], description: 'Review action.' },
          body: { type: 'string', description: 'Review body; required unless approving.' },
        },
        required: ['repo', 'number', 'event'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_merge_pull',
      description:
        'Merge an open pull request. The user approves every merge. This does not force anything or bypass branch protection.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'owner/name' },
          number: { type: 'integer', description: 'Pull request number.' },
          method: { type: 'string', enum: ['merge', 'squash', 'rebase'], description: 'Merge method, default merge.' },
          body: { type: 'string', description: 'Optional commit title.' },
          deleteBranch: { type: 'boolean', description: 'Delete the head branch after merging.' },
        },
        required: ['repo', 'number'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_actions',
      description:
        'Dispatch, rerun or cancel a GitHub Actions workflow. The user approves every action. Use github_list what=runs or what=workflows to find ids first.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'owner/name' },
          action: { type: 'string', enum: ['dispatch', 'rerun', 'cancel'], description: 'Action to perform.' },
          workflowId: { type: 'string', description: 'Numeric workflow id or file name such as ci.yml, for dispatch.' },
          ref: { type: 'string', description: 'Branch or tag to run, for dispatch.' },
          runId: { type: 'integer', description: 'Workflow run id, for rerun or cancel.' },
          inputs: { type: 'object', description: 'Optional workflow_dispatch input values.' },
        },
        required: ['repo', 'action'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_create_release',
      description:
        'Create a GitHub release from a tag. The user approves every release. The tag is created at the default branch if it does not exist.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'owner/name' },
          tag: { type: 'string', description: 'Tag name, for example v1.2.3.' },
          name: { type: 'string', description: 'Release title; defaults to the tag.' },
          body: { type: 'string', description: 'Release notes in markdown.' },
          draft: { type: 'boolean', description: 'Save as a draft.' },
          prerelease: { type: 'boolean', description: 'Mark as a prerelease.' },
        },
        required: ['repo', 'tag'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_create_repo',
      description:
        'Create a new repository owned by the signed-in user, with an initial README. The user approves every repository creation. Defaults to private.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Repository name.' },
          private: { type: 'boolean', description: 'Private repository, default true.' },
          description: { type: 'string', description: 'Optional short description.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_search',
      description: 'Search GitHub repositories, issues and pull requests, or code. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'GitHub search query.' },
          type: { type: 'string', enum: ['repos', 'issues', 'code'], description: 'What to search, default repos.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_pull',
      description:
        'Fast-forward the current branch of a cloned repository. The user approves every pull. Use it before editing an existing checkout.',
      parameters: {
        type: 'object',
        properties: {
          folder: { type: 'string', description: 'Existing clone folder inside the workspace.' },
          repo: { type: 'string', description: 'Optional owner/name to verify the checkout origin.' },
        },
        required: ['folder'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_push',
      description:
        'Push the current branch of a cloned repository to its GitHub origin. No force, tags or other branches. Commit locally first, then the user approves the push.',
      parameters: {
        type: 'object',
        properties: {
          folder: { type: 'string', description: 'Existing clone folder inside the workspace.' },
          repo: { type: 'string', description: 'Optional owner/name to verify the checkout origin.' },
        },
        required: ['folder'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_branch',
      description:
        'Create and switch to a local branch, or switch to an existing one, in a cloned repository. The user approves every branch change.',
      parameters: {
        type: 'object',
        properties: {
          folder: { type: 'string', description: 'Existing clone folder inside the workspace.' },
          name: { type: 'string', description: 'Branch name.' },
          create: { type: 'boolean', description: 'Create a new branch; false only switches. Default true.' },
        },
        required: ['folder', 'name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'render_chart',
      description:
        'Write a self-contained SVG chart as an HTML file in the workspace. Use it for line, bar or pie charts from labelled numeric data. The user approves the write.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Output .html path inside the workspace.' },
          title: { type: 'string', description: 'Chart title.' },
          type: { type: 'string', enum: ['line', 'bar', 'pie'], description: 'Chart type, default bar.' },
          data: {
            type: 'array',
            minItems: 1,
            maxItems: 200,
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                value: { type: 'number' },
              },
              required: ['label', 'value'],
              additionalProperties: false,
            },
            description: 'One labelled numeric value per point.'
          },
        },
        required: ['path', 'data'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'notify',
      description:
        'Send a short notification to the user-configured webhook. The destination comes from NOTIFY_WEBHOOK_URL in Secrets and cannot be chosen by the model. The user approves every message.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Message to send, at most 4 KB.' },
        },
        required: ['text'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'post_url',
      description:
        'Send one unauthenticated POST to a public URL and return a text response. No custom headers or credentials. Redirects are refused and the user approves every call.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Public http(s) URL.' },
          body: { type: 'string', description: 'Request body, at most 16 KB.' },
          contentType: { type: 'string', enum: ['application/json', 'text/plain', 'application/x-www-form-urlencoded'], description: 'Body content type.' },
        },
        required: ['url', 'body'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Run one allowlisted program inside the workspace folder, such as a test runner or a build step. There is no shell: arguments are passed literally, so pipes, && and redirection do nothing. The user approves every command before it starts.',
      parameters: {
        type: 'object',
        properties: {
          program: {
            type: 'string',
            description: 'Program name only, for example node or npm. It must be on the user allowlist.',
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Arguments, each passed to the program unchanged.',
          },
          cwd: {
            type: 'string',
            description: 'Folder inside the workspace to run in. Defaults to the workspace root.',
          },
        },
        required: ['program'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_tests',
      description:
        'Run the project test suite with an allowlisted program and return a parsed pass/fail summary with file, line and message for each failure. The user approves every run. Use it after a change, then fix the reported failures.',
      parameters: {
        type: 'object',
        properties: {
          program: { type: 'string', description: 'Program on the user allowlist, for example npm, node, pytest or cargo.' },
          args: { type: 'array', items: { type: 'string' }, description: 'Arguments, for example ["test"] or ["--test", "lib"].' },
          cwd: { type: 'string', description: 'Folder inside the workspace. Defaults to the root.' },
        },
        required: ['program'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Write a text file inside the workspace folder, creating folders as needed. The user approves every write before it happens, so explain what you are about to change.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to the workspace root.' },
          content: { type: 'string', description: 'The complete new contents of the file.' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_patch',
      description:
        'Change an existing file with exact-text edits instead of rewriting the whole file. Each find must occur exactly once; include enough surrounding text to make it unique. The user sees a real unified diff and must approve before anything is written. Prefer this over write_file when editing existing code.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to the workspace root. It must already exist.' },
          edits: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: {
              type: 'object',
              properties: {
                find: { type: 'string', description: 'Exact text to replace; it must occur exactly once.' },
                replace: { type: 'string', description: 'Text to put in its place, which may be empty.' },
              },
              required: ['find', 'replace'],
              additionalProperties: false,
            },
            description: 'Edits applied in order, at most 20.',
          },
        },
        required: ['path', 'edits'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scaffold_project',
      description:
        'Create a polished three-file static website (index.html, styles.css and app.js) in a folder. It is a safe starting point with no build step or dependencies, and it refuses to overwrite any existing file. The user approves the three writes before anything is created. Use write_file or apply_patch for later changes.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Page and brand title, up to 80 characters.' },
          tagline: { type: 'string', description: 'One sentence for the hero, up to 180 characters.' },
          folder: {
            type: 'string',
            description: 'Folder inside the workspace, such as my-site. Defaults to the workspace root.',
          },
          theme: {
            type: 'string',
            enum: ['midnight', 'paper', 'sunset'],
            description: 'Colour theme. Defaults to midnight.',
          },
        },
        required: ['title'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'preview_check',
      description:
        'Check a local HTML page and every local stylesheet, script and image it references. Reports missing files with the page that referenced them, so you can repair a broken preview before the user opens it. It does not execute JavaScript or fetch external URLs.',
      parameters: {
        type: 'object',
        properties: {
          entry: {
            type: 'string',
            description: 'HTML file relative to the workspace root. Defaults to index.html.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'preview_link',
      description:
        'Return a working link to the local preview of an HTML or SVG page in the workspace. Call it whenever the user asks for the preview link, or asks to see or be shown the page you built. It starts the private local preview server and returns the exact URL to give the user.',
      parameters: {
        type: 'object',
        properties: {
          entry: {
            type: 'string',
            description:
              'HTML or SVG file relative to the workspace root. Defaults to the best page the workspace has.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'screenshot_preview',
      description:
        'Capture the local preview with an installed headless Edge or Chrome after preview_check passes, so you can inspect layout, spacing, overflow and contrast. Desktop Build only, for vision-capable models; at most two captures per Build run. Run preview_check first; use this only when visual quality matters or the page looks wrong.',
      parameters: {
        type: 'object',
        properties: {
          entry: {
            type: 'string',
            description: 'HTML file relative to the workspace root. Defaults to index.html.',
          },
          viewport: {
            type: 'string',
            enum: ['desktop', 'mobile', 'tablet'],
            description: 'Capture size. Defaults to desktop (800×600); mobile is 390×844.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_open',
      description:
        'Open a local HTML or SVG preview in an installed headless Edge or Chrome and start an interactive browser session. Use this before browser_snapshot, browser_click, browser_type or browser_screenshot. The browser only opens the private loopback preview, and the user approves opening it.',
      parameters: {
        type: 'object',
        properties: {
          entry: {
            type: 'string',
            description: 'HTML or SVG file relative to the workspace root. Defaults to the best page the workspace has.',
          },
          viewport: {
            type: 'string',
            enum: ['desktop', 'mobile', 'tablet'],
            description: 'Browser window size. Defaults to desktop (800×600); mobile is 390×844.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_snapshot',
      description:
        'Read the current interactive browser page: title, visible text, interactive elements with stable uids, and recent console/network problems. Call it after browser_open, after an action, or after changing a page. Use the returned uids for browser_click and browser_type.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description:
        'Click an element by its uid from browser_snapshot. The user approves the click. Returns a fresh snapshot plus console and network diagnostics, so inspect the result instead of assuming the click worked.',
      parameters: {
        type: 'object',
        properties: {
          uid: { type: 'string', description: 'Element uid such as e1 from the latest browser_snapshot.' },
        },
        required: ['uid'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description:
        'Type text into an input, textarea, select or contenteditable element identified by a uid from browser_snapshot. The user approves it. Set submit to true to submit the surrounding form or press Enter. Returns a fresh snapshot and diagnostics.',
      parameters: {
        type: 'object',
        properties: {
          uid: { type: 'string', description: 'Element uid such as e2 from the latest browser_snapshot.' },
          text: { type: 'string', description: 'Text to enter; use an empty string to clear the field.' },
          submit: { type: 'boolean', description: 'Submit the form or press Enter after typing. Defaults to false.' },
        },
        required: ['uid', 'text'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_wait',
      description:
        'Wait up to 10 seconds for text or a CSS selector to appear in the interactive browser, then return a fresh snapshot. Use it after an action that loads or reveals content.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Visible text to wait for.' },
          selector: { type: 'string', description: 'CSS selector to wait for.' },
          timeoutMs: { type: 'integer', description: 'Maximum wait in milliseconds, 200-10000. Defaults to 5000.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_console',
      description:
        'Read recent browser console warnings, errors and uncaught exceptions from the interactive session. Use it when an action does not make sense or a page appears broken.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_network',
      description:
        'Read failed, 4xx and 5xx network requests from the interactive browser session. Use it to distinguish a layout problem from a missing API, asset or route.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_screenshot',
      description:
        'Capture the current interactive browser page for visual inspection. Desktop Build only, for vision-capable models, at most two captures per browser session. Use browser_snapshot first for text, element uids and errors.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_close',
      description: 'Close the interactive browser session and free its temporary profile. Use it when UI verification is finished.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_process',
      description:
        'Start a long-running program from the workspace, such as a dev server or a watcher, and leave it running after this turn. The program must be on the user allowlist and the user approves it first. The port it prints is detected once something accepts connections there. At most three run at once; call process_logs to follow the output and stop_process when it is no longer needed.',
      parameters: {
        type: 'object',
        properties: {
          program: {
            type: 'string',
            description: 'Program name only, for example node or npm. It must be on the user allowlist.',
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Arguments, each passed to the program unchanged.',
          },
          cwd: {
            type: 'string',
            description: 'Folder inside the workspace to run in. Defaults to the workspace root.',
          },
        },
        required: ['program'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'process_logs',
      description:
        'Read the recent output of a managed process started with start_process, including its port and whether it is still running. Defaults to the newest process. Output is bounded to the tail; call it again to follow a server that is still starting.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Process id such as dev-1. Defaults to the most recent managed process.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_process',
      description:
        'Stop one managed process by id and free its port, or stop every managed process when no id is given. The user approves it. Already stopped processes are left alone.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Process id such as dev-1. Omit to stop all managed processes.' },
        },
        additionalProperties: false,
      },
    },
  },
];

/* ------------------------------------------------------------- arithmetic */

function formatNumber(value) {
  return Number(value.toPrecision(12)).toString();
}

/**
 * Recursive-descent parser. No eval, no Function constructor: the string never
 * becomes code, so a hostile expression can only ever be arithmetic.
 */
export function parseArithmetic(input) {
  const src = String(input ?? '').replace(/\s+/g, '');
  if (!src) throw new Error('Empty expression');
  if (src.length > MAX_EXPRESSION) throw new Error('Expression is too long');
  if (!/^[0-9.+\-*/%^()]+$/.test(src)) {
    throw new Error('Only numbers and the operators + - * / % ^ ( ) are allowed');
  }

  let at = 0;

  function parseExpression() {
    let value = parseTerm();
    for (;;) {
      if (src[at] === '+') { at += 1; value += parseTerm(); }
      else if (src[at] === '-') { at += 1; value -= parseTerm(); }
      else return value;
    }
  }

  function parseTerm() {
    let value = parsePower();
    for (;;) {
      if (src[at] === '*') { at += 1; value *= parsePower(); }
      else if (src[at] === '/') {
        at += 1;
        const divisor = parsePower();
        if (divisor === 0) throw new Error('Division by zero');
        value /= divisor;
      } else if (src[at] === '%') {
        at += 1;
        const divisor = parsePower();
        if (divisor === 0) throw new Error('Division by zero');
        value %= divisor;
      } else return value;
    }
  }

  function parsePower() {
    const base = parseUnary();
    if (src[at] === '^') {
      at += 1;
      return Math.pow(base, parsePower());
    }
    return base;
  }

  function parseUnary() {
    if (src[at] === '-') { at += 1; return -parseUnary(); }
    if (src[at] === '+') { at += 1; return parseUnary(); }
    return parsePrimary();
  }

  function parsePrimary() {
    if (src[at] === '(') {
      at += 1;
      const value = parseExpression();
      if (src[at] !== ')') throw new Error('Missing closing parenthesis');
      at += 1;
      return value;
    }
    const start = at;
    while (at < src.length && /[0-9.]/.test(src[at])) at += 1;
    if (start === at) throw new Error(`Unexpected character "${src[at] ?? 'end'}"`);
    const value = Number(src.slice(start, at));
    if (!Number.isFinite(value)) throw new Error('Invalid number');
    return value;
  }

  const result = parseExpression();
  if (at !== src.length) throw new Error(`Unexpected character "${src[at]}"`);
  if (!Number.isFinite(result)) throw new Error('Result is not a finite number');
  return result;
}

/* -------------------------------------------------------------------- url */

function normaliseHost(host) {
  return String(host ?? '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
}

function privateIPv4(host) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  if (octets.some((part) => part > 255)) return true;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  // Documentation and benchmark ranges are never useful fetch targets.
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return false;
}

function privateIPv6(host) {
  // ::/8 covers loopback, unspecified and IPv4-mapped forms. Blocking the
  // whole reserved range is safer than trying to enumerate every notation.
  if (host.startsWith('::')) return true;
  if (/^f[cd]/.test(host)) return true;
  if (/^fe[89ab]/.test(host)) return true;
  // Deprecated site-local fec0::/10 is still accepted by some stacks.
  if (/^fe[c-f]/.test(host)) return true;
  if (/^ff/.test(host)) return true;
  if (/^2001:db8(?::|$)/.test(host)) return true;
  // NAT64 and 6to4 embed an IPv4 destination. That destination can be
  // loopback or RFC1918 even though the IPv6 literal looks global.
  if (/^64:ff9b(?::|$)/.test(host)) return true;
  if (/^2002(?::|$)/.test(host)) return true;
  // Teredo (2001::/32) and the unspecified forms are not useful public fetch
  // targets and may tunnel back to a local IPv4 address.
  if (/^2001:(?:0(?::|$)|:)/.test(host)) return true;
  return false;
}

function isPrivateHost(host) {
  if (!host) return true;
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    return true;
  }
  const family = isIP(host);
  if (family === 4) return privateIPv4(host) !== false;
  if (family === 6) return privateIPv6(host);
  // A host with a colon is malformed or an IPv6 form we do not understand.
  return host.includes(':');
}

/** Only ordinary public http(s) destinations are fetchable. */
export function isPublicUrl(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = normaliseHost(url.hostname);
  if (!host) return false;
  if (isPrivateHost(host)) return false;
  if (isIP(host) !== 0) return true;
  // A bare hostname may resolve to something on the local network; DNS is
  // checked again in publicUrlFor before the request is made.
  return host.includes('.');
}

async function publicUrlFor(raw) {
  if (!isPublicUrl(raw)) {
    throw new Error('Only public http(s) URLs can be fetched from here');
  }
  const url = new URL(String(raw));
  const host = normaliseHost(url.hostname);
  if (isIP(host) !== 0) return { url, addresses: null };

  let timer = null;
  let addresses;
  try {
    addresses = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS lookup timed out')), DNS_TIMEOUT_MS);
      }),
    ]);
  } catch {
    throw new Error('Could not verify that the address is public');
  } finally {
    clearTimeout(timer);
  }
  if (
    !Array.isArray(addresses) ||
    addresses.length === 0 ||
    addresses.some((entry) => isPrivateHost(normaliseHost(entry?.address)))
  ) {
    throw new Error('Only public http(s) URLs can be fetched from here');
  }
  return { url, addresses };
}

/** Supply exactly the addresses that were checked, so DNS cannot be rebound. */
function pinnedLookup(addresses) {
  let next = 0;
  return (_hostname, options, callback) => {
    if (!addresses?.length) {
      callback(Object.assign(new Error('No validated address'), { code: 'ENOTFOUND' }));
      return;
    }
    if (options?.all) {
      callback(null, addresses);
      return;
    }
    const entry = addresses[Math.min(next, addresses.length - 1)];
    next += 1;
    callback(null, entry.address, entry.family);
  };
}

/** One GET with the validated DNS answer pinned for the whole request. */
function requestPinned(url, addresses, init = {}) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(
      url,
      {
        method: init.method ?? 'GET',
        headers: { 'user-agent': 'Freeway/2.0 (local app)', ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        ...(addresses?.length ? { lookup: pinnedLookup(addresses) } : {}),
        ...(url.protocol === 'https:' ? { servername: url.hostname } : {}),
      },
      (response) => {
        const status = response.statusCode ?? 0;
        resolve({
          status,
          statusText: response.statusMessage ?? '',
          ok: status >= 200 && status < 300,
          url: url.href,
          headers: { get: (name) => response.headers[String(name).toLowerCase()] ?? null },
          stream: response,
        });
      },
    );
    request.on('error', reject);
    request.end(init.body ?? undefined);
  });
}

async function readLimitedText(response, maxBytes) {
  const chunks = [];
  let total = 0;
  if (response.stream) {
    for await (const value of response.stream) {
      if (!value?.length) continue;
      const take = value.subarray(0, maxBytes - total);
      chunks.push(take);
      total += take.length;
      if (total >= maxBytes) {
        response.stream.destroy();
        break;
      }
    }
  } else {
    const reader = response.body?.getReader();
    if (!reader) return '';
    try {
      while (total < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.length) continue;
        const take = value.subarray(0, maxBytes - total);
        chunks.push(take);
        total += take.length;
        if (take.length < value.length) break;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

/* ------------------------------------------------------------------- html */

export function htmlToText(html) {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|pre|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ------------------------------------------------------------------ tools */

function ok(content) {
  return { ok: true, content };
}

function fail(message) {
  return { ok: false, content: `Error: ${message}` };
}

export function currentTime(timezone) {
  const now = new Date();
  const zone = timezone ? String(timezone) : Intl.DateTimeFormat().resolvedOptions().timeZone;
  let local;
  try {
    local = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      dateStyle: 'full',
      timeStyle: 'long',
    }).format(now);
  } catch {
    throw new Error(`Unknown timezone "${zone}"`);
  }
  // en-GB's long format already ends with "UTC" for UTC, so only add the zone
  // name when it is not visible in the formatted text.
  const label = local.includes(zone) ? '' : ` (${zone})`;
  return `${local}${label}\nISO: ${now.toISOString()}`;
}

export async function fetchAsText(rawUrl, { fetchImpl = null } = {}) {
  let current = String(rawUrl ?? '');
  let response = null;

  // Redirects are followed by hand so every hop is checked before the next
  // request. `redirect: 'follow'` would already have reached a private address
  // by the time the final URL could be inspected.
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const { url, addresses } = await publicUrlFor(current);
    response = fetchImpl
      ? await fetchImpl(url.href, {
          redirect: 'manual',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: { 'user-agent': 'Freeway/2.0 (local app)' },
        })
      : await requestPinned(url, addresses);
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    if (!location) throw new Error('The request redirected without a destination');
    if (response.stream) response.stream.destroy();
    else await response.body?.cancel().catch(() => {});
    current = new URL(location, url).href;
    response = null;
  }
  if (!response) throw new Error('The request redirected too many times');
  if (!isPublicUrl(response.url || current)) throw new Error('The request was redirected to a private address');
  if (!response.ok) throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
  const type = response.headers.get('content-type') ?? '';
  const raw = await readLimitedText(response, MAX_FETCH_BYTES);
  const text = /html|xml/i.test(type) ? htmlToText(raw) : raw;
  return `URL: ${response.url}\n\n${text.slice(0, MAX_FETCH_CHARS)}`;
}

/** One approval-gated POST to a public URL. No redirects are followed. */
export async function postAsText(rawUrl, { body = '', contentType = 'text/plain', fetchImpl = null } = {}) {
  const payload = String(body ?? '');
  if (Buffer.byteLength(payload) > 16_000) throw new Error('A POST body is limited to 16 KB');
  const { url, addresses } = await publicUrlFor(rawUrl);
  const headers = {
    'content-type': String(contentType || 'text/plain'),
    accept: 'text/plain, application/json',
  };
  const response = fetchImpl
    ? await fetchImpl(url.href, {
        method: 'POST',
        body: payload,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
    : await requestPinned(url, addresses, { method: 'POST', body: payload, headers });
  if (response.status >= 300 && response.status < 400) {
    throw new Error('POST redirects are not followed');
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
  const text = await readLimitedText(response, MAX_FETCH_BYTES);
  return text.slice(0, MAX_FETCH_CHARS);
}

/**
 * Recover tool calls a model printed as text instead of sending through the
 * protocol. Free models do this often, and the shape is consistently
 * Hermes/Qwen XML:
 *
 *   <tool_call>
 *   <function=write_file>
 *   <parameter=path>hello/index.html</parameter>
 *   <parameter=content><!doctype html>…</parameter>
 *   </function>
 *   </tool_call>
 *
 * Also accepted: a JSON object inside the block ({"name":…,"arguments":…})
 * and a block that never got its closing tag, which is what a stream cut short
 * leaves behind. Anything else is returned untouched, so ordinary prose that
 * merely mentions the word is not mangled.
 */
export function parseTextToolCalls(text) {
  const raw = String(text ?? '');
  if (!/<tool_call>/i.test(raw)) return { calls: [], text: raw };

  // A stream that stopped mid-call leaves a block with no closing tag. Close it
  // here so both shapes go through one code path.
  const cut = /<tool_call>(?![\s\S]*<\/tool_call>)/i.test(raw);
  const source = cut ? `${raw}</tool_call>` : raw;

  const block = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  const calls = [];

  for (const match of source.matchAll(block)) {
    if (calls.length >= 8) break;
    const body = match[1] ?? '';

    // JSON form first: unambiguous when it parses.
    const trimmed = body.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        const name = String(parsed.name ?? parsed.function?.name ?? '').trim();
        if (name) {
          const args = parsed.arguments ?? parsed.parameters ?? parsed.function?.arguments ?? {};
          calls.push({
            name,
            arguments: typeof args === 'string' ? safeParseJson(args) : args && typeof args === 'object' ? args : {},
          });
          continue;
        }
      } catch {
        /* fall through to the XML form */
      }
    }

    const fn =
      /<function\s*=\s*([A-Za-z0-9_.:-]+)\s*>/i.exec(body) ??
      /<function\s+name\s*=\s*["']([^"']+)["']/i.exec(body);
    if (!fn) continue;

    const args = {};
    const param = /<parameter\s*=\s*([A-Za-z0-9_.:-]+)\s*>([\s\S]*?)<\/parameter>/gi;
    for (const entry of body.matchAll(param)) {
      args[entry[1].trim()] = entry[2].replace(/^\r?\n/, '').replace(/\r?\n$/, '');
    }
    calls.push({ name: fn[1].trim(), arguments: args });
  }

  // Drop the blocks from the visible answer, including a trailing block whose
  // closing tag never arrived.
  const cleaned = source
    .replace(block, '')
    .replace(/<tool_call>[\s\S]*$/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { calls, text: cleaned };
}

function safeParseJson(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

TOOL_DEFINITIONS.push(
  {
    type: 'function',
    function: {
      name: 'find_files',
      description:
        'Find workspace files by name or glob without a shell. Supports *, ** and ? (for example **/*.test.js); bare names match anywhere. Skips generated folders, secret files and symlinks. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'File name or glob, for example *.mjs or **/*.test.js.' },
          path: { type: 'string', description: 'Folder to search from, relative to the workspace root. Defaults to the root.' },
          maxResults: { type: 'integer', description: 'Maximum matches to return, 1-200. Defaults to 100.' },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_history',
      description:
        'Read bounded Git history without changing anything: mode log lists recent commits, mode show reads one commit with stat and optional patch. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['log', 'show'], description: 'log lists commits; show reads one commit. Defaults to log.' },
          ref: { type: 'string', description: 'Branch, tag or commit such as HEAD or main~2. Defaults to HEAD.' },
          path: { type: 'string', description: 'Optional file path to limit history or show output to.' },
          limit: { type: 'integer', description: 'For log: maximum commits, 1-30. Defaults to 10.' },
          diff: { type: 'boolean', description: 'For show: include the patch, not only the stat. Defaults to false.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'project_info',
      description:
        'Detect the package manager, lockfile, package scripts, frameworks and available test/lint/typecheck/build commands in a workspace folder. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project folder relative to the workspace root. Defaults to the root.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_check',
      description:
        'Run one package script already declared in package.json for test, lint, typecheck or build. The user approves the exact detected command and script. It never accepts a shell command or arbitrary arguments.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['test', 'lint', 'typecheck', 'build'], description: 'Which detected script to run.' },
          path: { type: 'string', description: 'Project folder relative to the workspace root. Defaults to the root.' },
        },
        required: ['kind'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_plan',
      description:
        'Write or revise the plan artifact for this chat. Use it in Plan mode after reading the workspace. It never changes a file: it records the goal, assumptions, ordered steps with files and verification, and risks for the user to approve.',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'What the change will achieve, in one or two sentences.' },
          assumptions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Facts assumed because they could not be checked. Keep this short.',
          },
          steps: {
            type: 'array',
            description: 'Ordered steps. Each one should be small enough to verify on its own.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Short imperative step title.' },
                detail: { type: 'string', description: 'What to change and why.' },
                files: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Workspace paths this step touches.',
                },
                verify: { type: 'string', description: 'The command or check that proves the step worked.' },
              },
              required: ['title'],
              additionalProperties: false,
            },
          },
          risks: {
            type: 'array',
            items: { type: 'string' },
            description: 'Things that could break, or decisions the user should confirm first.',
          },
        },
        required: ['goal', 'steps'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_plan_step',
      description:
        'Mark one step of the approved plan as pending, active or done while building it. Use the step number shown in the plan, starting at 0.',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'integer', description: 'Zero-based step index.' },
          status: { type: 'string', enum: ['pending', 'active', 'done'] },
        },
        required: ['index', 'status'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: 'Show the workspace Git branch, changed files and untracked files. Read-only; use it before suggesting a commit.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: 'Show a bounded unified diff of workspace changes, optionally for one path or the staged index. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Optional file path relative to the workspace root.' },
          staged: { type: 'boolean', description: 'Show staged changes instead of the working tree.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_commit',
      description: 'Commit only the named workspace paths. The user approves the commit. Hooks and signing are disabled; this never pushes.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Commit message, up to 500 characters.' },
          paths: { type: 'array', minItems: 1, maxItems: 40, items: { type: 'string' }, description: 'Files to commit, relative to the workspace root.' },
        },
        required: ['message', 'paths'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_revert',
      description: 'Restore tracked paths to HEAD in the working tree and index. The user approves it. Untracked files are refused, never deleted, and history is never rewritten.',
      parameters: {
        type: 'object',
        properties: {
          paths: { type: 'array', minItems: 1, maxItems: 40, items: { type: 'string' }, description: 'Tracked files to restore to HEAD.' },
        },
        required: ['paths'],
        additionalProperties: false,
      },
    },
  },

);

/**
 * Run one tool call. Never throws: the model needs a result string either way.
 * `ctx.getCatalog` lets tools read the live model list without a network hop.
 */
export async function runTool(name, args, ctx = {}) {
  const input = args && typeof args === 'object' ? args : {};
  try {
    switch (name) {
      case 'git_status': {
        if (!ctx.workspace?.isReady) return fail('No workspace folder is set. Ask the user to choose one in Settings.');
        return ok(await gitStatus(ctx.workspace.root));
      }
      case 'git_diff': {
        if (!ctx.workspace?.isReady) return fail('No workspace folder is set. Ask the user to choose one in Settings.');
        return ok(await gitDiff(ctx.workspace.root, input));
      }
      case 'git_history': {
        if (!ctx.workspace?.isReady) return fail('No workspace folder is set. Ask the user to choose one in Settings.');
        return ok(await gitHistory(ctx.workspace.root, input));
      }
      case 'git_commit': {
        if (!ctx.workspace?.isReady) return fail('No workspace folder is set. Ask the user to choose one in Settings.');
        const committed = await gitCommit(ctx.workspace.root, input);
        return ok(committed.content);
      }
      case 'git_revert': {
        if (!ctx.workspace?.isReady) return fail('No workspace folder is set. Ask the user to choose one in Settings.');
        return ok(await gitRevert(ctx.workspace.root, input));
      }
      case 'get_current_time':
        return ok(currentTime(input.timezone));
      case 'calculate': {
        const expression = input.expression ?? input.expr ?? '';
        return ok(`${expression} = ${formatNumber(parseArithmetic(expression))}`);
      }
      case 'fetch_url':
        return ok(await fetchAsText(input.url ?? ''));
      case 'list_files': {
        const sandbox = ctx.workspace;
        if (!sandbox?.isReady) {
          return fail('No workspace folder is set. Ask the user to choose one in Settings.');
        }
        const folder = sandbox.list(input.path || '.');
        const lines = folder.entries.map((entry) =>
          entry.type === 'dir' ? `${entry.name}/` : `${entry.name} (${entry.size} bytes)`,
        );
        return ok(`Folder: /${folder.path}\n${lines.join('\n') || '(empty)'}`);
      }
      case 'read_file': {
        const sandbox = ctx.workspace;
        if (!sandbox?.isReady) {
          return fail('No workspace folder is set. Ask the user to choose one in Settings.');
        }
        const file = sandbox.read(input.path ?? '');
        return ok(`File: /${file.path} (${file.size} bytes)\n\n${file.content}`);
      }
      case 'search_files': {
        const sandbox = ctx.workspace;
        if (!sandbox?.isReady) {
          return fail('No workspace folder is set. Ask the user to choose one in Settings.');
        }
        const query = String(input.query ?? input.pattern ?? '');
        const found = sandbox.search(input.path || '.', query, {
          regex: input.regex === true,
          caseSensitive: input.caseSensitive === true,
          maxResults: input.maxResults,
        });
        const header =
          `Search: /${found.root} for ${JSON.stringify(query)} — ` +
          `${found.matches.length} match(es) in ${found.scanned} file(s) scanned`;
        if (found.matches.length === 0) {
          return ok(`${header}\n(no matches)`);
        }
        const lines = found.matches.map((m) => `${m.path}:${m.line}: ${m.text}`);
        if (found.truncated) lines.push('(stopped at the result limit; narrow the search or raise maxResults)');
        return ok([header, ...lines].join('\n'));
      }
      case 'find_files': {
        const sandbox = ctx.workspace;
        if (!sandbox?.isReady) {
          return fail('No workspace folder is set. Ask the user to choose one in Settings.');
        }
        const found = sandbox.find(input.pattern, {
          path: input.path || '.',
          maxResults: input.maxResults,
        });
        const header =
          `Found ${found.files.length} file(s) in /${found.root || '.'} ` +
          `(${found.scanned} scanned)`;
        if (found.files.length === 0) return ok(`${header}\n(no matches)`);
        const lines = found.files.map((file) => `${file.path} (${file.size} bytes)`);
        if (found.truncated) {
          lines.push('(stopped at the result or scan limit; narrow the pattern or raise maxResults)');
        }
        return ok([header, ...lines].join('\n'));
      }
      case 'read_many': {
        const sandbox = ctx.workspace;
        if (!sandbox?.isReady) {
          return fail('No workspace folder is set. Ask the user to choose one in Settings.');
        }
        const batch = sandbox.readMany(input.paths);
        const parts = batch.files.map((file) =>
          file.error
            ? `Skipped /${file.path}: ${file.error}`
            : `File: /${file.path} (${file.size} bytes)\n\n${file.content}`,
        );
        return ok(
          `Read ${batch.files.length} file(s), ${batch.total} bytes total.\n\n${parts.join('\n\n---\n\n')}`,
        );
      }
      case 'project_info': {
        const sandbox = ctx.workspace;
        if (!sandbox?.isReady) {
          return fail('No workspace folder is set. Ask the user to choose one in Settings.');
        }
        return ok(formatProjectInfo(inspectProject(sandbox, { path: input.path || '.' })));
      }
      case 'github_list': {
        const client = ctx.github;
        if (!client?.hasToken) {
          return fail('GitHub is not connected. Ask the user to connect it in the GitHub panel.');
        }
        const what = String(input.what ?? 'repos');
        if (what === 'repos') {
          const rows = await client.repos();
          return ok(
            rows.map((r) => `${r.fullName}${r.private ? ' (private)' : ''} — ${r.description || 'no description'}`).join('\n') ||
              '(no repositories)',
          );
        }
        if (what === 'repo') {
          const item = await client.repo(input.repo);
          return ok(
            `${item.fullName} — ${item.private ? 'private' : 'public'}, default branch ${item.defaultBranch}\n` +
              `${item.description || 'no description'}\n${item.htmlUrl || ''}`,
          );
        }
        if (what === 'branches') {
          const rows = await client.branches(input.repo);
          return ok(
            rows.map((b) => `${b.name}${b.protected ? ' (protected)' : ''} ${b.sha}`).join('\n') || '(no branches)',
          );
        }
        if (what === 'issues') {
          const rows = await client.issues(input.repo, input.state ?? 'open');
          return ok(
            rows.map((i) => `#${i.number} ${i.title} (${i.state}, ${i.comments} comments)`).join('\n') ||
              '(no issues)',
          );
        }
        if (what === 'issue') {
          const item = await client.issue(input.repo, input.number);
          return ok(`#${item.number} ${item.title} (${item.state})\n${item.body || '(no body)'}\n${item.url}`);
        }
        if (what === 'pulls') {
          const rows = await client.pulls(input.repo, input.state ?? 'open');
          return ok(
            rows.map((p) => `#${p.number} ${p.title} (${p.draft ? 'draft, ' : ''}${p.state})`).join('\n') ||
              '(no pull requests)',
          );
        }
        if (what === 'pull') {
          const item = await client.pull(input.repo, input.number);
          return ok(
            `#${item.number} ${item.title} (${item.state}${item.merged ? ', merged' : ''})\n` +
              `${item.head} → ${item.base}, ${item.changedFiles} files, +${item.additions}/-${item.deletions}\n` +
              `${item.body || '(no body)'}\n${item.url}`,
          );
        }
        if (what === 'commits') {
          const rows = await client.commits(input.repo, input.branch);
          return ok(rows.map((c) => `${c.sha} ${c.message} — ${c.author}`).join('\n') || '(no commits)');
        }
        if (what === 'commit') {
          const item = await client.commit(input.repo, input.sha);
          const files = item.files.map((f) => `  ${f.status} ${f.filename} (+${f.additions}/-${f.deletions})`);
          return ok(
            `${item.sha} ${item.message.split('\n')[0]} — ${item.author}\n` +
              (item.stats ? `${item.stats.total} changes: +${item.stats.additions}/-${item.stats.deletions}\n` : '') +
              files.join('\n') +
              `\n${item.url || ''}`,
          );
        }
        if (what === 'reviews') {
          const rows = await client.reviews(input.repo, input.number);
          return ok(
            rows.map((r) => `@${r.user || 'unknown'}: ${r.state}${r.body ? ` — ${r.body}` : ''}`).join('\n') ||
              '(no reviews)',
          );
        }
        if (what === 'comments') {
          const rows = await client.comments(input.repo, input.number);
          return ok(
            rows.map((c) => `@${c.user || 'unknown'}: ${c.body}`).join('\n') || '(no comments)',
          );
        }
        if (what === 'workflows') {
          const rows = await client.workflows(input.repo);
          return ok(rows.map((w) => `${w.name} [${w.state}] ${w.path}`).join('\n') || '(no workflows)');
        }
        if (what === 'runs') {
          const rows = await client.workflowRuns(input.repo);
          return ok(
            rows
              .map((r) => `${r.name} #${r.number} ${r.status}${r.conclusion ? ` / ${r.conclusion}` : ''} (${r.branch || 'no branch'})`)
              .join('\n') || '(no workflow runs)',
          );
        }
        if (what === 'releases') {
          const rows = await client.releases(input.repo);
          return ok(
            rows.map((r) => `${r.tag} ${r.name}${r.draft ? ' (draft)' : ''}${r.prerelease ? ' (prerelease)' : ''}`).join('\n') ||
              '(no releases)',
          );
        }
        return fail(`Unknown list "${what}".`);
      }
      case 'github_create_issue': {
        const client = ctx.github;
        if (!client?.hasToken) {
          return fail('GitHub is not connected. Ask the user to connect it in the GitHub panel.');
        }
        const issue = await client.createIssue(input.repo, input.title, input.body);
        return ok(`Opened issue #${issue.number}: ${issue.title}\n${issue.url}`);
      }
      case 'github_clone': {
        if (!ctx.github?.hasToken) {
          return fail('GitHub is not connected. Ask the user to connect it in the GitHub panel.');
        }
        if (!ctx.workspace?.isReady) {
          return fail('No workspace folder is set. Ask the user to choose one in Settings.');
        }
        if (typeof ctx.githubClone !== 'function') {
          return fail('Cloning GitHub repositories is not available in this edition.');
        }
        const cloned = await ctx.githubClone(input.repo, input.folder);
        return ok(
          `Cloned ${cloned.repo} into /${cloned.folder} (${cloned.files} top-level entries, latest commit only). ` +
            'Use list_files or read_file on that folder to inspect it.',
        );
      }
      case 'github_update_issue': {
        const client = ctx.github;
        if (!client?.hasToken) return fail('GitHub is not connected. Ask the user to connect it in the GitHub panel.');
        const issue = await client.updateIssue(input.repo, input.number, {
          state: input.state,
          labels: input.labels,
        });
        return ok(`Updated #${issue.number} to ${issue.state}.\n${issue.url}`);
      }
      case 'github_comment': {
        const client = ctx.github;
        if (!client?.hasToken) return fail('GitHub is not connected. Ask the user to connect it in the GitHub panel.');
        const comment = await client.comment(input.repo, input.number, input.body);
        return ok(`Posted comment ${comment.id} on #${input.number}.\n${comment.url}`);
      }
      case 'github_create_pull': {
        const client = ctx.github;
        if (!client?.hasToken) return fail('GitHub is not connected. Ask the user to connect it in the GitHub panel.');
        const pull = await client.createPull(input.repo, {
          title: input.title,
          head: input.head,
          base: input.base,
          body: input.body,
          draft: input.draft,
        });
        return ok(`Opened pull request #${pull.number}: ${pull.title}\n${pull.url}`);
      }
      case 'github_review_pull': {
        const client = ctx.github;
        if (!client?.hasToken) return fail('GitHub is not connected. Ask the user to connect it in the GitHub panel.');
        const review = await client.reviewPull(input.repo, input.number, {
          event: input.event,
          body: input.body,
        });
        return ok(`Submitted ${review.state} review ${review.id} on #${input.number}.\n${review.url}`);
      }
      case 'github_merge_pull': {
        const client = ctx.github;
        if (!client?.hasToken) return fail('GitHub is not connected. Ask the user to connect it in the GitHub panel.');
        const merged = await client.mergePull(input.repo, input.number, {
          method: input.method,
          body: input.body,
          deleteBranch: input.deleteBranch,
        });
        return ok(
          merged.merged
            ? `Merged #${input.number}${merged.sha ? ` at ${merged.sha}` : ''}.\n${merged.message}`
            : `GitHub did not merge #${input.number}: ${merged.message}`,
        );
      }
      case 'github_actions': {
        const client = ctx.github;
        if (!client?.hasToken) return fail('GitHub is not connected. Ask the user to connect it in the GitHub panel.');
        const action = String(input.action ?? '');
        if (action === 'dispatch') {
          const result = await client.dispatchWorkflow(input.repo, {
            workflowId: input.workflowId,
            ref: input.ref,
            inputs: input.inputs,
          });
          return ok(`Dispatched ${result.workflow} on ${result.ref}.`);
        }
        if (action === 'rerun') {
          const result = await client.rerunWorkflow(input.repo, input.runId);
          return ok(`Asked GitHub to rerun workflow run ${result.runId}.`);
        }
        if (action === 'cancel') {
          const result = await client.cancelWorkflow(input.repo, input.runId);
          return ok(`Asked GitHub to cancel workflow run ${result.runId}.`);
        }
        return fail('Action must be dispatch, rerun or cancel.');
      }
      case 'github_create_release': {
        const client = ctx.github;
        if (!client?.hasToken) return fail('GitHub is not connected. Ask the user to connect it in the GitHub panel.');
        const release = await client.createRelease(input.repo, {
          tag: input.tag,
          name: input.name,
          body: input.body,
          draft: input.draft,
          prerelease: input.prerelease,
        });
        return ok(`Created release ${release.tag}.\n${release.url}`);
      }
      case 'github_create_repo': {
        const client = ctx.github;
        if (!client?.hasToken) return fail('GitHub is not connected. Ask the user to connect it in the GitHub panel.');
        const created = await client.createRepo({
          name: input.name,
          private: input.private,
          description: input.description,
        });
        return ok(
          `Created ${created.fullName} (${created.private ? 'private' : 'public'}, default ${created.defaultBranch}).\n${created.url}`,
        );
      }
      case 'github_search': {
        const client = ctx.github;
        if (!client?.hasToken) return fail('GitHub is not connected. Ask the user to connect it in the GitHub panel.');
        const result = await client.search(input.query, input.type);
        const rows = result.items.map((item) =>
          result.type === 'code'
            ? `${item.repo || '?'} ${item.path}\n  ${item.url}`
            : `${item.fullName || `#${item.number}`} ${item.title || item.description || ''}\n  ${item.url}`,
        );
        return ok(`GitHub ${result.type} search: ${result.total} results\n${rows.join('\n') || '(none)'}`);
      }
      case 'github_pull': {
        if (!ctx.github?.hasToken) return fail('GitHub is not connected. Ask the user to connect it in the GitHub panel.');
        if (!ctx.workspace?.isReady) return fail('No workspace folder is set. Ask the user to choose one in Settings.');
        if (typeof ctx.githubPull !== 'function') return fail('GitHub pull is not available in this edition.');
        const pulled = await ctx.githubPull(input.repo, input.folder);
        return ok(`Pulled ${pulled.repo} in /${pulled.folder}.\n${pulled.output || 'Already up to date.'}`);
      }
      case 'github_push': {
        if (!ctx.github?.hasToken) return fail('GitHub is not connected. Ask the user to connect it in the GitHub panel.');
        if (!ctx.workspace?.isReady) return fail('No workspace folder is set. Ask the user to choose one in Settings.');
        if (typeof ctx.githubPush !== 'function') return fail('GitHub push is not available in this edition.');
        const pushed = await ctx.githubPush(input.repo, input.folder);
        return ok(`Pushed ${pushed.branch} to ${pushed.repo}.\n${pushed.output || 'Everything up to date.'}`);
      }
      case 'github_branch': {
        if (!ctx.workspace?.isReady) return fail('No workspace folder is set. Ask the user to choose one in Settings.');
        if (typeof ctx.githubBranch !== 'function') return fail('Git branch switching is not available in this edition.');
        const changed = await ctx.githubBranch(input.folder, input.name, input.create);
        return ok(
          `${changed.created ? 'Created and switched to' : 'Switched to'} ${changed.branch} in /${changed.folder}.\n${changed.output || ''}`,
        );
      }
      case 'render_chart': {
        if (!ctx.workspace?.isReady) return fail('No workspace folder is set. Ask the user to choose one in Settings.');
        const path = String(input.path ?? '').trim();
        if (!/\.html?$/i.test(path)) return fail('Chart output must be an .html file.');
        const html = buildChartHtml(input);
        const written = ctx.workspace.write(path, html);
        return ok(`Wrote ${written.size} bytes to /${written.path}. Use preview_link to open it.`);
      }
      case 'notify': {
        if (typeof ctx.notify !== 'function') return fail('Webhook notifications are not available in this edition.');
        const text = String(input.text ?? '').trim();
        if (!text) return fail('Write a notification message first.');
        if (Buffer.byteLength(text) > 4_000) return fail('A notification is limited to 4 KB.');
        await ctx.notify(text);
        return ok('Notification sent to the configured webhook.');
      }
      case 'post_url': {
        const contentType = String(input.contentType ?? 'text/plain');
        if (!['application/json', 'text/plain', 'application/x-www-form-urlencoded'].includes(contentType)) {
          return fail('Content type must be JSON, text or form encoded.');
        }
        const text = await postAsText(input.url, { body: input.body, contentType });
        return ok(`POST ${input.url}\n\n${text || '(empty response)'}`);
      }
      case 'run_command': {
        const runner = ctx.commands;
        if (!runner?.isReady) {
          return fail(
            'Running commands is off. Ask the user to enable it and add the program in Settings.',
          );
        }
        const result = await runner.run(
          { program: input.program, args: input.args, cwd: input.cwd },
          (chunk) => ctx.onCommandOutput?.(chunk),
        );
        const lines = [`$ ${[result.program, ...result.args].join(' ')}`];
        if (result.error) lines.push(`error: ${result.error}`);
        else if (result.timedOut) lines.push('timed out and was stopped');
        else lines.push(`exit code ${result.exitCode ?? 'none'}`);
        if (result.stdout.trim()) lines.push('stdout:', result.stdout.trimEnd());
        if (result.stderr.trim()) lines.push('stderr:', result.stderr.trimEnd());
        if (result.truncated) lines.push('(output was cut at the size limit)');
        return { ok: result.ok, content: lines.join('\n') };
      }
      case 'run_tests': {
        const runner = ctx.commands;
        if (!runner?.isReady) {
          return fail('Running tests is off. Ask the user to enable commands and allowlist the test program.');
        }
        const result = await runner.run(
          {
            program: input.program,
            args: Array.isArray(input.args) ? input.args : ['test'],
            cwd: input.cwd,
          },
          (chunk) => ctx.onCommandOutput?.(chunk),
        );
        const parsed = parseTestOutput([result.stdout, result.stderr].filter(Boolean).join('\n'), {
          exitCode: result.exitCode,
        });
        const lines = [`${parsed.summary} (exit ${result.exitCode ?? 'none'})`];
        if (result.error) lines.push(`error: ${result.error}`);
        if (result.timedOut) lines.push('timed out and was stopped');
        for (const failure of parsed.failures) {
          const where = failure.file ? ` — ${failure.file}${failure.line ? `:${failure.line}` : ''}` : '';
          lines.push(`- ${failure.test}${where}\n  ${failure.message}`);
        }
        if (result.truncated) lines.push('(output was cut at the size limit)');
        return { ok: result.ok && parsed.passed, content: lines.join('\n') };
      }
      case 'run_check': {
        const runner = ctx.commands;
        if (!runner?.isReady) {
          return fail('Running checks is off. Ask the user to enable commands and allowlist the package manager.');
        }
        const check = resolveCheck(ctx.workspace, input);
        const result = await runner.run(
          { program: check.program, args: check.args, cwd: check.cwd },
          (chunk) => ctx.onCommandOutput?.(chunk),
        );
        const parsed = parseCheckOutput(
          [result.stdout, result.stderr].filter(Boolean).join('\n'),
          { kind: check.kind, exitCode: result.exitCode },
        );
        const lines = [
          `$ ${[check.program, ...check.args].join(' ')}`,
          `script ${check.script}: ${check.scriptBody || '(empty)'}`,
        ];
        if (result.error) lines.push(`error: ${result.error}`);
        else if (result.timedOut) lines.push('timed out and was stopped');
        else lines.push(`${parsed.summary} (exit ${result.exitCode ?? 'none'})`);
        for (const item of parsed.diagnostics) {
          const where = item.file ? ` — ${item.file}${item.line ? `:${item.line}` : ''}` : '';
          lines.push(`- ${item.message}${where}`);
        }
        if (result.truncated) lines.push('(output was cut at the size limit)');
        return {
          ok: !result.error && !result.timedOut && parsed.passed,
          content: lines.join('\n'),
        };
      }
      case 'propose_plan': {
        const plan = normalizePlan(input);
        if (!plan) return fail('A plan needs a goal and at least one step.');
        return ok(planToMarkdown(plan));
      }
      case 'update_plan_step': {
        const index = Number(input.index);
        const status = String(input.status ?? '');
        if (!Number.isInteger(index) || index < 0) return fail('index must be a zero-based whole number.');
        if (!['pending', 'active', 'done'].includes(status)) {
          return fail('status must be pending, active or done.');
        }
        return ok(`Plan step ${index + 1} is now ${status}.`);
      }
      case 'scaffold_project': {
        const sandbox = ctx.workspace;
        if (!sandbox?.isReady) {
          return fail('No workspace folder is set. Ask the user to choose one in Settings.');
        }
        const scaffold = buildScaffold(input);
        const existing = scaffold.files
          .filter((file) => sandbox.exists(file.path))
          .map((file) => file.path);
        if (existing.length > 0) {
          return fail(
            `Will not overwrite existing file(s): ${existing.map((file) => `/${file}`).join(', ')}. ` +
              'Choose another folder, or edit the existing files with write_file/apply_patch.',
          );
        }
        const written = scaffold.files.map((file) => sandbox.write(file.path, file.content));
        return {
          ok: true,
          content:
            `Created a ${scaffold.theme} static site in /${scaffold.folder || '.'}:\n` +
            written.map((file) => `- /${file.path} (${file.size} bytes)`).join('\n') +
            `\n\nOpen /${scaffold.entry} in the Preview panel, then run preview_check to verify every reference.`,
          path: scaffold.entry,
          files: written.map((file) => file.path),
        };
      }
      case 'preview_check': {
        const sandbox = ctx.workspace;
        if (!sandbox?.isReady) {
          return fail('No workspace folder is set. Ask the user to choose one in Settings.');
        }
        return checkPreview(sandbox, input);
      }
      case 'preview_link': {
        const sandbox = ctx.workspace;
        if (!sandbox?.isReady) {
          return fail('No workspace folder is set. Ask the user to choose one in Settings.');
        }
        if (typeof ctx.previewLink !== 'function') {
          return fail('Preview links are available in the desktop app.');
        }
        return ctx.previewLink(input.entry);
      }
      case 'screenshot_preview': {
        const sandbox = ctx.workspace;
        if (!sandbox?.isReady) {
          return fail('No workspace folder is set. Ask the user to choose one in Settings.');
        }
        if (typeof ctx.screenshot !== 'function') {
          return fail(
            'Screenshot verification is available in desktop Build mode with a vision-capable OpenRouter model chain.',
          );
        }
        // A broken reference is cheaper to fix from a text diagnostic than
        // from a picture, and the browser would only render an error page.
        const checked = checkPreview(sandbox, input);
        if (!checked.ok) {
          return {
            ...checked,
            content: `${checked.content}\n\nNo screenshot was taken because the static check failed.`,
          };
        }
        const shot = await ctx.screenshot({
          entry: checked.entry,
          ...(input.viewport ? { viewport: input.viewport } : {}),
        });
        if (!shot.ok) return shot;
        return {
          ...shot,
          content: `${shot.content}\n\nStatic check first:\n${checked.content}`,
        };
      }
      case 'browser_open': {
        const manager = ctx.browser;
        if (!manager) return fail('Interactive browser tools are available in the desktop app only.');
        if (typeof ctx.previewLink !== 'function') return fail('Preview links are available in the desktop app.');
        const link = await ctx.previewLink(input.entry);
        if (!link?.ok) return link ?? fail('No local preview page is available.');
        return manager.open(link.url, { entry: link.entry, viewport: input.viewport });
      }
      case 'browser_snapshot': {
        if (!ctx.browser) return fail('Interactive browser tools are available in the desktop app only.');
        return ctx.browser.snapshotResult();
      }
      case 'browser_click': {
        if (!ctx.browser) return fail('Interactive browser tools are available in the desktop app only.');
        return ctx.browser.click(input.uid);
      }
      case 'browser_type': {
        if (!ctx.browser) return fail('Interactive browser tools are available in the desktop app only.');
        return ctx.browser.type(input.uid, input.text, input.submit === true);
      }
      case 'browser_wait': {
        if (!ctx.browser) return fail('Interactive browser tools are available in the desktop app only.');
        return ctx.browser.wait(input);
      }
      case 'browser_console': {
        if (!ctx.browser) return fail('Interactive browser tools are available in the desktop app only.');
        return ctx.browser.console();
      }
      case 'browser_network': {
        if (!ctx.browser) return fail('Interactive browser tools are available in the desktop app only.');
        return ctx.browser.network();
      }
      case 'browser_screenshot': {
        if (!ctx.browser) return fail('Interactive browser tools are available in the desktop app only.');
        return ctx.browser.screenshot();
      }
      case 'browser_close': {
        if (!ctx.browser) return fail('Interactive browser tools are available in the desktop app only.');
        await ctx.browser.close();
        return ok('Closed the interactive browser session.');
      }
      case 'start_process': {
        const manager = ctx.processes;
        if (!manager) {
          return fail('Managed processes are available in the desktop app only.');
        }
        const record = await manager.start(
          { program: input.program, args: input.args, cwd: input.cwd },
          { root: ctx.processRoot ?? '' },
        );
        const process = manager.list().find((item) => item.id === record.id) ?? record;
        const command = `$ ${[process.program, ...(process.args ?? [])].join(' ')}`;
        const tail = manager.logs(process.id, { bytes: 1200 })?.text?.trimEnd() ?? '';
        if (process.status !== 'running') {
          const why =
            process.error ??
            (process.exitCode === null ? 'it stopped' : `it exited with code ${process.exitCode}`);
          return {
            ok: false,
            content: [command, `${process.id} did not stay running: ${why}.`, tail].filter(Boolean).join('\n'),
            process,
          };
        }
        const lines = [command, `${process.id} is running in the background.`];
        if (process.port && process.ready) {
          lines.push(`Port ${process.port} — ${process.url} (opened from the Preview panel).`);
        } else if (process.port) {
          lines.push(
            `It printed port ${process.port}, but nothing is listening there yet. Call process_logs again in a moment.`,
          );
        } else {
          lines.push(
            'No port has been detected yet. It may still be starting; call process_logs to read the output.',
          );
        }
        lines.push('It keeps running after this turn. Call stop_process when it is no longer needed.');
        if (tail) lines.push('', tail);
        return { ok: true, content: lines.join('\n'), process };
      }
      case 'process_logs': {
        const manager = ctx.processes;
        if (!manager) {
          return fail('Managed processes are available in the desktop app only.');
        }
        const read = manager.logs(input.id, { bytes: 8000 });
        if (!read) {
          return fail('No managed process matches that id. Call start_process first, or omit id for the newest one.');
        }
        const process = read.process;
        const where = process.port
          ? `port ${process.port}${process.ready ? '' : ' (not accepting connections yet)'}`
          : 'no port yet';
        const header = `${process.id} (${process.program}) — ${process.status}, ${where}, ${Math.round(process.ms / 1000)}s`;
        const lines = [header];
        if (process.error) lines.push(process.error);
        if (read.clipped) lines.push('(showing the newest output only)');
        lines.push('', read.text.trimEnd() || '(no output yet)');
        return { ok: true, content: lines.join('\n'), process };
      }
      case 'stop_process': {
        const manager = ctx.processes;
        if (!manager) {
          return fail('Managed processes are available in the desktop app only.');
        }
        const stopped = await manager.stop(input.id ? String(input.id) : undefined);
        if (!stopped) {
          return fail('No managed process matches that id. Omit id to stop every managed process.');
        }
        if (stopped.length === 0) return ok('No managed process is running.');
        return ok(
          stopped
            .map((process) => `${process.id} (${process.program}) is ${process.status}; its port is free.`)
            .join('\n'),
        );
      }
      case 'write_file': {
        const sandbox = ctx.workspace;
        if (!sandbox?.isReady) {
          return fail('No workspace folder is set. Ask the user to choose one in Settings.');
        }
        const saved = sandbox.write(input.path ?? '', input.content ?? '');
        return ok(`Wrote /${saved.path} (${saved.size} bytes).`);
      }
      case 'apply_patch': {
        const sandbox = ctx.workspace;
        if (!sandbox?.isReady) {
          return fail('No workspace folder is set. Ask the user to choose one in Settings.');
        }
        const patched = sandbox.applyPatch(input);
        return ok(
          `Patched /${patched.path} with ${patched.edits} edit(s); ` +
            `it is now ${patched.size} bytes.\n\n${patched.diff}`,
        );
      }
      default:
        return fail(`Unknown tool "${name}"`);
    }
  } catch (error) {
    return fail(String(error?.message ?? error));
  }
}
