// A deliberately small Markdown block parser for document exports. It covers
// headings, paragraphs, lists, fenced code, tables and horizontal rules. Inline
// HTML is treated as text, never rendered.

const MAX_MARKDOWN = 500_000;

function mdBad(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export function markdownInline(value) {
  return String(value ?? '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();
}

export function parseMarkdownBlocks(input) {
  const source = String(input ?? '').replace(/\r\n?/g, '\n');
  if (!source.trim()) throw mdBad('There is no Markdown to export.');
  if (Buffer.byteLength(source) > MAX_MARKDOWN) throw mdBad('That Markdown is too large to export.');
  const lines = source.split('\n');
  const blocks = [];
  let index = 0;
  let paragraph = [];

  const flush = () => {
    const text = markdownInline(paragraph.join(' '));
    if (text) blocks.push({ type: 'p', text });
    paragraph = [];
  };

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      flush();
      index += 1;
      continue;
    }
    const fence = /^```([A-Za-z0-9_-]*)\s*$/.exec(line);
    if (fence) {
      flush();
      index += 1;
      const code = [];
      while (index < lines.length && !/^```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: `h${heading[1].length}`, text: markdownInline(heading[2]) });
      index += 1;
      continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\123]*$/.test(line)) {
      flush();
      blocks.push({ type: 'hr', text: '' });
      index += 1;
      continue;
    }
    const list = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (list) {
      flush();
      blocks.push({ type: 'li', text: markdownInline(list[1]) });
      index += 1;
      continue;
    }
    if (line.includes('|') && index + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]+/.test(lines[index + 1])) {
      flush();
      const cells = (value) => value.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => markdownInline(cell));
      const header = cells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(cells(lines[index]));
        index += 1;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    if (/^\s*<[^>]+>/.test(line)) {
      flush();
      index += 1;
      continue;
    }
    paragraph.push(line.trim());
    index += 1;
  }
  flush();
  if (blocks.length === 0) throw mdBad('There is no readable Markdown to export.');
  return blocks;
}
