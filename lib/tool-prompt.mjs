// A model is much more likely to use workspace tools when the turn says they
// are enabled. The tool definitions alone do not tell it that the user chose
// this in Settings, or that it should inspect files instead of guessing.
//
// Kept in one place so the desktop server and the cloud Worker cannot drift.
export const TOOL_USE_INSTRUCTION =
  'Tool use is enabled in Settings for this turn. Use the available tools when they can answer more reliably than guessing, especially to inspect or change workspace files. Check file contents before describing or editing them. Do not call a tool for a simple conversational reply, and never say a tool ran unless its result is in the conversation.';

const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Put the tool-use instruction at the front of an upstream request. Returns the
 * original list unchanged when no tools are actually offered, so a disabled
 * toggle (or a model that rejected tools) never gets a prompt claiming it can
 * use them.
 */
export function withToolInstruction(messages, tools) {
  if (!Array.isArray(messages) || !Array.isArray(tools) || tools.length === 0) {
    return messages;
  }
  const names = tools
    .map((tool) => String(tool?.function?.name ?? ''))
    .filter((name) => TOOL_NAME.test(name));
  const available = names.length > 0 ? ` Available tools: ${names.join(', ')}.` : '';
  const screenshot = names.includes('screenshot_preview')
    ? ' After changing a page, run preview_check first; use screenshot_preview only when visual layout or quality matters.'
    : '';
  const preview = names.includes('preview_link')
    ? ' When the user asks for a preview link, or asks to see a page you built, call preview_link and give the returned URL exactly; never invent a preview address.'
    : '';
  const browser = names.includes('browser_open')
    ? ' For UI work, open the local preview with browser_open, use browser_snapshot to find elements, and use browser_click or browser_type for interactions. Each action returns a fresh snapshot plus console and network problems. After a page edit while the browser session is open, the app reloads it and returns a fresh check; fix reported errors before finishing.'
    : '';
  const github = names.includes('github_list')
    ? ' For questions about the user\'s GitHub repositories, call github_list first instead of guessing. To work on code, github_clone the repository, read and edit it locally, use git_commit, then github_push; use github_branch for local branches and github_create_pull for the pull request. Issues, comments, reviews, merges, releases and Actions have their own tools. Every GitHub write needs approval. Never claim a GitHub action happened unless the tool result is in the conversation.'
    : '';
  return [
    { role: 'system', content: TOOL_USE_INSTRUCTION + available + screenshot + preview + browser + github },
    ...messages,
  ];
}
