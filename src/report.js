// Report formats: text for a terminal, Markdown for a pull request or job summary, JSON for other tools
// (and as the --baseline of the next run), CSV for a spreadsheet.

import { formatSize } from './size.js';

const MODES = { vite: 'Vite manifest', next: 'Next.js build', glob: 'each file alone' };

function inputs(r) {
  const s = r.sources || {};
  const parts = [];
  if (r.mode === 'vite') parts.push(`${MODES.vite} ${s.manifest}, folder ${s.dir}`);
  else if (r.mode === 'next') parts.push(`${MODES.next} ${s.next}`);
  else if (r.mode === 'glob') parts.push(`folder ${s.dir}, ${MODES.glob}`);
  else parts.push('build output');
  if (s.config) parts.push(`budget ${s.config}`);
  if (s.baseline) parts.push(`baseline ${s.baseline}`);
  return parts.join(', ');
}

function plural(n, one, many = `${one}s`) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

function summaryLine(r) {
  const s = r.summary;
  const b = s.bytes;
  const pages = r.mode === 'glob' ? plural(s.entries, 'file') : plural(s.entries, r.mode === 'next' ? 'route' : 'page');
  const lazy = r.mode === 'vite' ? `, ${plural(s.lazy, 'lazy chunk')}` : '';
  return `sizes: ${r.compression}; ${pages}${lazy}; ${s.jsFiles} JS and ${s.cssFiles} CSS files (raw ${formatSize(b.raw)}, gzip ${formatSize(b.gzip)}, brotli ${formatSize(b.brotli)}); ${plural(s.sourceMaps, 'source map')}`;
}

function findingSummary(r) {
  return `${r.counts.error} error, ${r.counts.warning} warning, ${r.counts.info} info`;
}

const size = (n) => (n === null || n === undefined ? '-' : formatSize(n));

function budgetText(b) {
  if (!b) return '-';
  return `${size(b.js)} / ${size(b.css)} / ${size(b.total)}`;
}

function growthText(g) {
  if (!g) return '';
  const sign = g.change > 0 ? '+' : '';
  return `${sign}${formatSize(g.change)}${g.percent === null ? '' : ` (${sign}${g.percent.toFixed(1)}%)`}`;
}

function entryRows(r) {
  const withGrowth = r.entries.some((e) => e.growth);
  const head = [r.mode === 'glob' ? 'File' : r.mode === 'next' ? 'Route' : 'Page', 'JS', 'CSS', 'Total', 'Budget (JS / CSS / total)', 'Status'];
  if (withGrowth) head.push('Growth');
  const rows = r.entries.map((e) => {
    const row = [r.mode === 'next' && e.kind === 'app' ? `${e.name} (app)` : e.name, size(e.js), size(e.css), size(e.total), budgetText(e.budget), e.status];
    if (withGrowth) row.push(growthText(e.growth) || '-');
    return row;
  });
  return { head, rows };
}

function lazyRows(r) {
  return {
    head: ['Lazy chunk', 'JS', 'CSS', 'Total', 'Budget', 'Status'],
    rows: r.lazy.map((l) => [l.name, size(l.js), size(l.css), size(l.total), size(l.budget), l.status])
  };
}

function largestRows(r) {
  return {
    head: [`Largest files (by ${r.compression})`, 'raw', 'gzip', 'brotli'],
    rows: r.largest.map((f) => [f.file, size(f.raw), size(f.gzip), size(f.brotli)])
  };
}

function textTable({ head, rows }) {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => String(row[i]).length)));
  const line = (cells) => cells.map((c, i) => (i === cells.length - 1 ? String(c) : String(c).padEnd(widths[i]))).join('  ').trimEnd();
  return [line(head), ...rows.map(line)];
}

export function toText(r) {
  const lines = [
    `bundle-budget-check: ${inputs(r)}`,
    summaryLine(r),
    `findings: ${findingSummary(r)}`
  ];
  if (r.entries.length) lines.push('', ...textTable(entryRows(r)));
  if (r.lazy.length) lines.push('', ...textTable(lazyRows(r)));
  if (r.largest.length) lines.push('', ...textTable(largestRows(r)));
  if (!r.findings.length) lines.push('', 'no findings');
  for (const f of r.findings) lines.push('', `${f.severity.toUpperCase().padEnd(8)}  ${f.id.padEnd(23)}  ${f.message}`);
  if (r.notes.length) lines.push('');
  for (const n of r.notes) lines.push(`note: ${n}`);
  lines.push('', r.gate.pass ? `GATE: PASS (--fail-on ${r.gate.failOn})` : `GATE: FAIL - ${r.gate.reason}`);
  return lines.join('\n') + '\n';
}

// A Markdown table cell: backslashes and pipes escaped, line breaks flattened, so text from a manifest cannot break the table.
export function mdCell(t) {
  return String(t).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n|\r/g, ' ');
}

function mdTable({ head, rows }) {
  return [
    `| ${head.map(mdCell).join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(mdCell).join(' | ')} |`)
  ];
}

export function toMarkdown(r) {
  const lines = [
    `## bundle-budget-check: ${findingSummary(r)}`,
    '',
    `${mdCell(inputs(r))}.`,
    '',
    `${mdCell(summaryLine(r))}.`
  ];
  if (r.entries.length) lines.push('', ...mdTable(entryRows(r)));
  if (r.lazy.length) lines.push('', ...mdTable(lazyRows(r)));
  if (r.largest.length) lines.push('', ...mdTable(largestRows(r)));
  if (!r.findings.length) lines.push('', 'No findings.');
  else {
    lines.push('', '| Severity | Check | Message |', '| --- | --- | --- |');
    for (const f of r.findings) lines.push(`| ${f.severity} | ${mdCell(f.id)} | ${mdCell(f.message)} |`);
  }
  if (r.notes.length) lines.push('');
  for (const n of r.notes) lines.push(`- ${mdCell(n)}`);
  lines.push('', r.gate.pass ? `**Gate passed** (--fail-on ${r.gate.failOn}).` : `**Gate failed:** ${mdCell(r.gate.reason)}.`);
  return lines.join('\n') + '\n';
}

export function toJson(r) {
  return JSON.stringify(r, null, 2) + '\n';
}

// RFC 4180 quoting, and a leading quote on cells a spreadsheet would read as a formula.
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// One row per page, per lazy chunk and per finding; sizes in bytes, in the compression of the report.
export function toCsv(r) {
  const rows = [['type', 'severity', 'id', 'name', 'js', 'css', 'total', 'budget_js', 'budget_css', 'budget_total', 'status', 'message']];
  for (const e of r.entries) rows.push([e.kind === 'file' ? 'file' : 'page', '', '', e.name, e.js, e.css, e.total, e.budget?.js, e.budget?.css, e.budget?.total, e.status, '']);
  for (const l of r.lazy) rows.push(['lazy', '', '', l.name, l.js, l.css, l.total, '', '', l.budget, l.status, '']);
  for (const f of r.findings) rows.push(['finding', f.severity, f.id, f.name ?? f.file, '', '', f.size, '', '', f.budget, '', f.message]);
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
