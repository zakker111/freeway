// Minimal WordprocessingML writer. It produces the five parts Word needs for a
// basic document: content types, package rels, document, document rels and
// styles. Tables are real Word tables; images and embedded fonts are not
// supported, which keeps this dependency-free.

import { createZip } from './zip.mjs';
import { parseMarkdownBlocks } from './markdown.mjs';

function xml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function paragraph(text, style = null) {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  const runs = String(text ?? '')
    .split('\n')
    .map((line, index) => `${index ? '<w:r><w:br/></w:r>' : ''}<w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r>`)
    .join('');
  return `<w:p>${pPr}${runs || '<w:r><w:t></w:t></w:r>'}</w:p>`;
}

function table(block) {
  const columns = Math.max(block.header.length, ...block.rows.map((row) => row.length), 1);
  const width = Math.floor(9_000 / columns);
  const cell = (text) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:color="cbd5e1"/><w:bottom w:val="single" w:sz="4" w:color="cbd5e1"/><w:left w:val="single" w:sz="4" w:color="cbd5e1"/><w:right w:val="single" w:sz="4" w:color="cbd5e1"/></w:tcBorders></w:tcPr>${paragraph(text)}</w:tc>`;
  const row = (cells) => `<w:tr>${Array.from({ length: columns }, (_, index) => cell(cells[index] ?? '')).join('')}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${Array.from({ length: columns }, () => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${row(block.header)}${block.rows.map(row).join('')}</w:tbl>${paragraph('')}`;
}

export function buildDocx(markdown, { title = 'Freeway export' } = {}) {
  const blocks = parseMarkdownBlocks(markdown);
  const body = [];
  body.push(paragraph(title, 'Title'));
  for (const block of blocks) {
    if (block.type === 'h1' || block.type === 'h2' || block.type === 'h3' || block.type === 'h4' || block.type === 'h5' || block.type === 'h6') {
      body.push(paragraph(block.text, block.type === 'h1' ? 'Heading1' : 'Heading2'));
    } else if (block.type === 'li') {
      body.push(paragraph(`• ${block.text}`, 'ListParagraph'));
    } else if (block.type === 'code') {
      body.push(paragraph(block.text, 'Code'));
    } else if (block.type === 'table') {
      body.push(table(block));
    } else if (block.type === 'hr') {
      body.push(paragraph('────────────────────────────────────────'));
    } else {
      body.push(paragraph(block.text));
    }
  }
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/></w:rPr></w:style>
</w:styles>`;
  return createZip([
    { path: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { path: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { path: 'word/document.xml', data: document },
    { path: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { path: 'word/styles.xml', data: styles },
  ]);
}
