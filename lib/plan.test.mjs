import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlan, planToMarkdown, PLAN_TOOL_NAMES } from './plan.mjs';
import { normalizeThread } from './store.mjs';
import { TOOL_DEFINITIONS, runTool } from './tools.mjs';

test('a plan without a goal or steps is rejected', () => {
  assert.equal(normalizePlan(null), null);
  assert.equal(normalizePlan({}), null);
  assert.equal(normalizePlan({ assumptions: ['x'] }), null);
  assert.equal(normalizePlan({ steps: [] }), null);
});

test('plan fields are trimmed, bounded and statuses are closed', () => {
  const plan = normalizePlan({
    goal: '  Ship it  ',
    assumptions: ['  one  ', '', 'two'],
    steps: [
      { title: '  Read  ', detail: ' details ', files: ['a.mjs'], verify: ' test ', status: 'done' },
      { title: 'Bad status', status: 'exploded' },
      { title: '' },
    ],
    risks: ['  careful  '],
  });
  assert.equal(plan.goal, 'Ship it');
  assert.deepEqual(plan.assumptions, ['one', 'two']);
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].status, 'done');
  assert.equal(plan.steps[1].status, 'pending');
  assert.equal(plan.risks[0], 'careful');
  assert.equal(normalizePlan({ goal: 'x', steps: Array.from({ length: 20 }, (_, i) => ({ title: `s${i}` })) }).steps.length, 12);
});

test('the approved plan keeps files and verification for Build', () => {
  const plan = normalizePlan({
    goal: 'Fix the parser',
    steps: [{ title: 'Patch it', detail: 'Change one line', files: ['lib/a.mjs'], verify: 'node --test' }],
  });
  const text = planToMarkdown(plan);
  assert.match(text, /Goal: Fix the parser/);
  assert.match(text, /1\. Patch it \[pending\]/);
  assert.match(text, /Files: lib\/a\.mjs/);
  assert.match(text, /Verify: node --test/);
});

test('plan mode cannot advertise a mutating tool', () => {
  for (const name of ['write_file', 'apply_patch', 'run_command', 'run_tests', 'github_create_issue', 'github_clone', 'github_update_issue', 'github_comment', 'github_create_pull', 'github_review_pull', 'github_merge_pull', 'github_actions', 'github_create_release', 'github_create_repo', 'github_pull', 'github_push', 'github_branch', 'render_chart', 'notify', 'post_url', 'scaffold_project', 'screenshot_preview', 'start_process', 'stop_process', 'process_logs', 'git_commit', 'git_revert', 'run_check', 'browser_open', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_wait', 'browser_console', 'browser_network', 'browser_screenshot', 'browser_close']) {
    assert.equal(PLAN_TOOL_NAMES.has(name), false, `${name} must not be a plan tool`);
  }
  for (const name of ['read_file', 'list_files', 'search_files', 'find_files', 'project_info', 'git_history', 'git_status', 'git_diff', 'preview_check', 'propose_plan']) {
    assert.equal(PLAN_TOOL_NAMES.has(name), true, `${name} must stay available in plan mode`);
  }
  const offered = TOOL_DEFINITIONS.map((tool) => tool.function.name);
  for (const name of ['propose_plan', 'update_plan_step']) assert.ok(offered.includes(name), `${name} is missing`);
});

test('the plan tools return a plan and a step update without touching files', async () => {
  const proposed = await runTool('propose_plan', {
    goal: 'Ship',
    steps: [{ title: 'One' }, { title: 'Two' }],
  });
  assert.equal(proposed.ok, true);
  assert.match(proposed.content, /Goal: Ship/);
  assert.match(proposed.content, /2\. Two/);

  const updated = await runTool('update_plan_step', { index: 1, status: 'done' });
  assert.equal(updated.ok, true);
  assert.match(updated.content, /step 2 is now done/);
  assert.equal((await runTool('update_plan_step', { index: -1, status: 'done' })).ok, false);
  assert.equal((await runTool('update_plan_step', { index: 0, status: 'shipped' })).ok, false);
});

test('a saved chat keeps its mode and plan, and old chats default to build', () => {
  const saved = normalizeThread({
    id: 'plan-thread-1',
    title: 'Plan',
    messages: [{ role: 'user', content: 'plan it' }],
    mode: 'plan',
    plan: { goal: 'Ship', steps: [{ title: 'One' }] },
  });
  assert.equal(saved.mode, 'plan');
  assert.equal(saved.plan.goal, 'Ship');
  assert.equal(saved.plan.steps[0].status, 'pending');

  const old = normalizeThread({ messages: [{ role: 'user', content: 'old' }] });
  assert.equal(old.mode, 'build');
  assert.equal(old.plan, null);
});
