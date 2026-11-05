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
  return [{ role: 'system', content: TOOL_USE_INSTRUCTION + available }, ...messages];
}
