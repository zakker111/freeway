// Text-first PDF writer using the standard Helvetica and Courier fonts. It
// supports headings, paragraphs, lists, code, simple tables and page breaks.
// Images, custom fonts and exact HTML layout are intentionally out of scope.

import { parseMarkdownBlocks } from './markdown.mjs';

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 50;

function pdfText(value) {
  return String(value ?? '')
    .replace(/[^\x20-\x7e\n]/g, '?')
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)');
}

function wrap(text, width) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const out = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if (line.length + word.length + 1 <= width) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

function styleFor(block) {
  if (block.type === 'h1') return { size: 20, font: 'F2', width: 66, gap: 12 };
  if (block.type === 'h2' || /^h[3-6]$/.test(block.type)) return { size: 15, font: 'F2', width: 86, gap: 9 };
  if (block.type === 'code') return { size: 9, font: 'F3', width: 100, gap: 5 };
  if (block.type === 'li') return { size: 11, font: 'F1', width: 86, indent: 14, prefix: '• ' };
  return { size: 11, font: 'F1', width: 90, gap: 5 };
}

export function buildPdf(markdown, { title = 'Freeway export' } = {}) {
  const blocks = parseMarkdownBlocks(markdown);
  const pages = [];
  let lines = [];
  let y = PAGE_H - MARGIN;

  const newPage = () => {
    if (lines.length) pages.push(lines);
    lines = [];
    y = PAGE_H - MARGIN;
  };
  const add = (text, { size = 11, font = 'F1', indent = 0 } = {}) => {
    const step = size + 5;
    if (y - step < MARGIN) newPage();
    lines.push({ text, size, font, indent });
    y -= step;
  };

  add(title, { size: 20, font: 'F2' });
  y -= 8;
  for (const block of blocks) {
    if (block.type === 'table') {
      const header = block.header.join(' | ');
      add(header, { size: 10, font: 'F2' });
      for (const row of block.rows) {
        for (const line of wrap(row.join(' | '), 100)) add(line, { size: 9, font: 'F1', indent: 4 });
      }
      y -= 4;
      continue;
    }
    if (block.type === 'hr') {
      add('────────────────────────────────────────', { size: 11, font: 'F1' });
      continue;
    }
    const style = styleFor(block);
    for (const line of wrap(`${style.prefix ?? ''}${block.text}`, style.width)) {
      add(line, style);
    }
    y -= style.gap ?? 4;
  }
  if (lines.length) pages.push(lines);

  const objects = [];
  const addObject = (value) => {
    objects.push(value);
    return objects.length;
  };
  addObject('<< /Type /Catalog /Pages 2 0 R >>');
  addObject(''); // pages, filled below
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
  const kids = [];
  for (const page of pages) {
    let content = '';
    let cy = PAGE_H - MARGIN;
    for (const line of page) {
      cy -= line.size + 5;
      content += `BT /${line.font} ${line.size} Tf ${MARGIN + (line.indent ?? 0)} ${cy.toFixed(2)} Td (${pdfText(line.text)}) Tj ET\n`;
    }
    const contentId = addObject(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`);
    const pageId = addObject(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentId} 0 R >>`);
    kids.push(pageId);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let output = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets[index + 1] = Buffer.byteLength(output, 'latin1');
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    output += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
}
