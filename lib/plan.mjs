// The plan artifact for Plan mode. A plan is data the chat owns, never a file
// in the workspace: the browser renders it, the thread store saves it, and
// Build sends it back to the model as the approved task.

const STATUSES = new Set(['pending', 'active', 'done']);
const MAX_STEPS = 12;

function cleanPlanText(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function cleanPlanList(value, max, limit) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanPlanText(item, limit))
    .filter(Boolean)
    .slice(0, max);
}

/**
 * Normalise anything a model, a saved thread or a request body sends.
 * Returns null when there is no plan worth showing.
 */
export function normalizePlan(input) {
  if (!input || typeof input !== 'object') return null;
  const goal = cleanPlanText(input.goal, 500);
  const steps = Array.isArray(input.steps)
    ? input.steps
        .slice(0, MAX_STEPS)
        .map((raw) => {
          const title = cleanPlanText(raw?.title, 200);
          if (!title) return null;
          return {
            title,
            detail: cleanPlanText(raw?.detail, 600),
            files: cleanPlanList(raw?.files, 10, 200),
            verify: cleanPlanText(raw?.verify, 300),
            status: STATUSES.has(raw?.status) ? raw.status : 'pending',
          };
        })
        .filter(Boolean)
    : [];
  if (!goal && steps.length === 0) return null;
  return {
    goal,
    assumptions: cleanPlanList(input.assumptions, 8, 300),
    steps,
    risks: cleanPlanList(input.risks, 6, 300),
  };
}

/** The approved plan, in a form the Build turn can act on. */
export function planToMarkdown(plan) {
  if (!plan) return '';
  const lines = [`Goal: ${plan.goal}`];
  if (plan.assumptions.length > 0) {
    lines.push('', 'Assumptions:', ...plan.assumptions.map((item) => `- ${item}`));
  }
  lines.push('', 'Steps:');
  plan.steps.forEach((step, index) => {
    lines.push(`${index + 1}. ${step.title} [${step.status}]`);
    if (step.detail) lines.push(`   ${step.detail}`);
    if (step.files.length > 0) lines.push(`   Files: ${step.files.join(', ')}`);
    if (step.verify) lines.push(`   Verify: ${step.verify}`);
  });
  if (plan.risks.length > 0) {
    lines.push('', 'Risks:', ...plan.risks.map((item) => `- ${item}`));
  }
  return lines.join('\n');
}

/**
 * Tools Plan mode sends. Everything here reads or describes; nothing writes,
 * patches, runs a command, creates an issue or changes settings.
 */
export const PLAN_TOOL_NAMES = new Set([
  'get_current_time',
  'calculate',
  'fetch_url',
  'list_files',
  'read_file',
  'search_files',
  'read_many',
  'preview_check',
  'github_list',
  'propose_plan',
  'update_plan_step',
]);
