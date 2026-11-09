// Dependency-free line, bar and pie charts rendered as inline SVG. The output
// is one HTML file with no scripts, fonts, images or network requests, so it
// works in the existing local preview unchanged.

const MAX_POINTS = 200;
const WIDTH = 900;
const HEIGHT = 480;
const COLORS = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2', '#be123c', '#4d7c0f'];

function chartBad(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function chartNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw chartBad(`${label} must be a finite number.`);
  return number;
}

export function normalizeChart(input = {}) {
  const type = String(input.type ?? 'bar').toLowerCase();
  if (!['bar', 'line', 'pie'].includes(type)) {
    throw chartBad('Chart type must be bar, line or pie.');
  }
  const title = String(input.title ?? 'Chart').trim().slice(0, 120) || 'Chart';
  const data = Array.isArray(input.data) ? input.data : [];
  if (data.length < 1) throw chartBad('A chart needs at least one data point.');
  if (data.length > MAX_POINTS) throw chartBad(`A chart can have at most ${MAX_POINTS} points.`);
  const points = data.map((item, index) => {
    const label = String(item?.label ?? `Item ${index + 1}`).trim().slice(0, 40) || `Item ${index + 1}`;
    const value = chartNumber(item?.value, `Value for ${label}`);
    if (type === 'pie' && value < 0) throw chartBad('Pie charts need non-negative values.');
    return { label, value };
  });
  if (type === 'pie' && points.reduce((sum, point) => sum + point.value, 0) <= 0) {
    throw chartBad('A pie chart needs at least one positive value.');
  }
  return { type, title, points };
}

function axisChart({ type, title, points }) {
  const left = 72;
  const right = 34;
  const top = 62;
  const bottom = 76;
  const plotW = WIDTH - left - right;
  const plotH = HEIGHT - top - bottom;
  const values = points.map((point) => point.value);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const span = rawMax - rawMin || 1;
  const yOf = (value) => top + plotH - ((value - rawMin) / span) * plotH;
  const xOf = (index) => left + ((index + 0.5) / points.length) * plotW;
  const parts = [];
  parts.push(`<rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="#ffffff" stroke="#cbd5e1"/>`);
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = rawMin + (span * tick) / 4;
    const y = yOf(value);
    parts.push(`<line x1="${left}" y1="${y.toFixed(1)}" x2="${left + plotW}" y2="${y.toFixed(1)}" stroke="#e2e8f0"/>`);
    parts.push(`<text x="${left - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="#64748b">${escapeXml(Number(value.toPrecision(4)))}</text>`);
  }
  const baseline = yOf(0);
  if (type === 'bar') {
    const width = Math.max(2, (plotW / points.length) * 0.58);
    points.forEach((point, index) => {
      const x = xOf(index) - width / 2;
      const y = yOf(point.value);
      const height = Math.abs(baseline - y);
      parts.push(`<rect x="${x.toFixed(1)}" y="${Math.min(y, baseline).toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" rx="2" fill="${COLORS[index % COLORS.length]}"><title>${escapeXml(point.label)}: ${escapeXml(point.value)}</title></rect>`);
    });
  } else {
    const coords = points.map((point, index) => `${xOf(index).toFixed(1)},${yOf(point.value).toFixed(1)}`);
    parts.push(`<polyline points="${coords.join(' ')}" fill="none" stroke="${COLORS[0]}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`);
    points.forEach((point, index) => {
      parts.push(`<circle cx="${xOf(index).toFixed(1)}" cy="${yOf(point.value).toFixed(1)}" r="4" fill="${COLORS[index % COLORS.length]}"><title>${escapeXml(point.label)}: ${escapeXml(point.value)}</title></circle>`);
    });
  }
  points.forEach((point, index) => {
    const x = xOf(index);
    parts.push(`<text x="${x.toFixed(1)}" y="${HEIGHT - 46}" text-anchor="middle" font-size="12" fill="#334155">${escapeXml(point.label)}</text>`);
  });
  parts.push(`<line x1="${left}" y1="${baseline.toFixed(1)}" x2="${left + plotW}" y2="${baseline.toFixed(1)}" stroke="#64748b"/>`);
  return parts.join('');
}

function pieChart({ points }) {
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const cx = 300;
  const cy = 260;
  const radius = 150;
  const parts = [];
  let angle = -Math.PI / 2;
  points.forEach((point, index) => {
    const next = angle + (point.value / total) * Math.PI * 2;
    const x1 = cx + Math.cos(angle) * radius;
    const y1 = cy + Math.sin(angle) * radius;
    const x2 = cx + Math.cos(next) * radius;
    const y2 = cy + Math.sin(next) * radius;
    const large = next - angle > Math.PI ? 1 : 0;
    parts.push(`<path d="M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${COLORS[index % COLORS.length]}" stroke="#ffffff" stroke-width="2"><title>${escapeXml(point.label)}: ${escapeXml(point.value)} (${((point.value / total) * 100).toFixed(1)}%)</title></path>`);
    angle = next;
  });
  points.forEach((point, index) => {
    const y = 120 + index * 28;
    if (y > 410) return;
    parts.push(`<rect x="520" y="${y - 12}" width="14" height="14" rx="2" fill="${COLORS[index % COLORS.length]}"/>`);
    parts.push(`<text x="544" y="${y}" font-size="14" fill="#1e293b">${escapeXml(point.label)} — ${escapeXml(Number(point.value.toPrecision(6)))} (${((point.value / total) * 100).toFixed(1)}%)</text>`);
  });
  return parts.join('');
}

export function buildChartHtml(input = {}) {
  const chart = normalizeChart(input);
  const body = chart.type === 'pie' ? pieChart(chart) : axisChart(chart);
  const rows = chart.points
    .map((point) => `<tr><td>${escapeXml(point.label)}</td><td>${escapeXml(point.value)}</td></tr>`)
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeXml(chart.title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px; background: #f8fafc; color: #0f172a; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 980px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  p.sub { margin: 0 0 16px; color: #64748b; font-size: 13px; }
  svg { display: block; width: 100%; height: auto; }
  table { width: 100%; margin-top: 18px; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; }
  th { color: #475569; }
  td:last-child, th:last-child { text-align: right; font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
<main>
  <h1>${escapeXml(chart.title)}</h1>
  <p class="sub">${chart.type} chart · ${chart.points.length} point${chart.points.length === 1 ? '' : 's'}</p>
  <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeXml(chart.title)}">
    ${body}
  </svg>
  <table>
    <thead><tr><th>Label</th><th>Value</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</main>
</body>
</html>
`;
}
