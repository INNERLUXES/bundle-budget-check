// Checks the sizes of a build against its budgets.
// docs/method.md gives the reason behind every check and how the size of a page is counted.

import { parseSize, formatSize, COMPRESSIONS } from './size.js';

export const SEVERITIES = ['error', 'warning', 'info'];
export const RANK = { error: 0, warning: 1, info: 2 };
export const METRICS = ['js', 'css', 'total'];

export const FINDINGS = [
  { id: 'over-budget', severity: 'error', what: 'A page loads more JavaScript, CSS or both together up front than its budget allows' },
  { id: 'file-over-budget', severity: 'error', what: 'A single JavaScript or CSS file is larger than files.max' },
  { id: 'missing-file', severity: 'error', what: 'A manifest names a file that is not in the build output folder' },
  { id: 'growth', severity: 'warning / error', what: 'A page grew since the baseline report; an error when it grew more than --max-growth' },
  { id: 'lazy-over-budget', severity: 'warning', what: 'A chunk loaded later, through a dynamic import, adds more than lazy.max' },
  { id: 'source-map-shipped', severity: 'warning', what: 'Source maps in the build output folder would be deployed with it' },
  { id: 'duplicate-chunk-content', severity: 'info', what: 'Two or more output files have exactly the same content' },
  { id: 'no-budget', severity: 'info', what: 'Pages that no budget applies to' }
];

const ORDER = Object.fromEntries(FINDINGS.map((f, i) => [f.id, i]));

export function isFindingId(id) {
  return Object.hasOwn(ORDER, id);
}

// Text from the input: control and direction characters removed and length capped, so it cannot rewrite a terminal.
export function safeText(value, max = 300) {
  const s = String(value).replace(/[\u0000-\u001f\u007f-\u009f\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g, ' ');
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

export function meetsThreshold(severity, failOn) {
  return RANK[severity] <= RANK[failOn];
}

function plural(n, one, many = `${one}s`) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

function quoteList(items, max = 5) {
  const shown = items.slice(0, max).join(', ');
  return items.length > max ? `${shown} and ${(items.length - max).toLocaleString('en-US')} more` : shown;
}

// A pattern from the "entries" of a budget file as a regular expression: * matches any characters except /,
// ** matches any characters including /. Everything else matches itself.
export function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i += 1;
      } else re += '[^/]*';
    } else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 's');
}

function readLimits(value, where, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`budget file: ${where} must be an object`);
  const out = {};
  for (const k of Object.keys(value)) if (!keys.includes(k)) throw new Error(`budget file: unknown key "${safeText(k, 60)}" in ${where} (expected ${keys.join(', ')})`);
  for (const k of keys) out[k] = value[k] === undefined || value[k] === null ? null : parseSize(value[k], `budget file: ${where}.${k}`);
  return out;
}

// The budget file, checked and with every size in bytes.
export function parseBudget(config) {
  if (config === null || config === undefined) return { compression: null, default: null, entries: [], files: null, lazy: null };
  if (typeof config !== 'object' || Array.isArray(config)) throw new Error('budget file: expected an object');
  const known = ['compression', 'default', 'entries', 'files', 'lazy'];
  for (const k of Object.keys(config)) if (!known.includes(k)) throw new Error(`budget file: unknown key "${safeText(k, 60)}" (expected ${known.join(', ')})`);
  if (config.compression !== undefined && !COMPRESSIONS.includes(config.compression)) {
    throw new Error(`budget file: "compression" is gzip, brotli or raw, not ${safeText(String(config.compression), 40)}`);
  }
  const entries = [];
  if (config.entries !== undefined) {
    if (!config.entries || typeof config.entries !== 'object' || Array.isArray(config.entries)) throw new Error('budget file: "entries" must be an object of patterns');
    for (const [pattern, value] of Object.entries(config.entries)) {
      if (!pattern) throw new Error('budget file: an empty pattern in "entries"');
      entries.push({ pattern, re: globToRegExp(pattern), ...readLimits(value, `entries "${safeText(pattern, 80)}"`, METRICS) });
    }
  }
  return {
    compression: config.compression ?? null,
    default: config.default === undefined ? null : readLimits(config.default, 'default', METRICS),
    entries,
    files: config.files === undefined ? null : readLimits(config.files, 'files', ['max']),
    lazy: config.lazy === undefined ? null : readLimits(config.lazy, 'lazy', ['max'])
  };
}

// The budget for one page: the pattern written exactly as the name wins, then the first pattern that matches, in file order.
// Limits the pattern leaves out come from "default". Returns { js, css, total, pattern } or null when nothing applies.
export function budgetFor(name, budgets) {
  const match = budgets.entries.find((e) => e.pattern === name) || budgets.entries.find((e) => e.re.test(name)) || null;
  if (!match && !budgets.default) return null;
  const base = budgets.default || { js: null, css: null, total: null };
  const out = { pattern: match ? match.pattern : 'default' };
  for (const m of METRICS) out[m] = match && match[m] !== null ? match[m] : base[m];
  if (METRICS.every((m) => out[m] === null)) return null;
  return out;
}

// --max-growth: a percentage ("5%") or a size ("10 KB").
export function parseGrowth(value) {
  if (value === null || value === undefined) return null;
  const m = /^\s*(\d{1,6}(?:\.\d{1,4})?)\s*%\s*$/.exec(String(value));
  if (m) return { percent: Number(m[1]), bytes: null, text: `${Number(m[1])}%` };
  const bytes = parseSize(String(value), '--max-growth');
  return { percent: null, bytes, text: formatSize(bytes) };
}

// A previous JSON report, as a map from "kind:name" to the sizes of that page.
export function readBaseline(data) {
  if (!data || typeof data !== 'object' || data.tool !== 'bundle-budget-check' || !Array.isArray(data.entries)) {
    throw new Error('baseline: not a JSON report of bundle-budget-check (run it with --format json and keep the output)');
  }
  const map = new Map();
  for (const e of data.entries) {
    if (!e || typeof e.name !== 'string' || !e.sizes || typeof e.sizes !== 'object') continue;
    map.set(`${e.kind}:${e.name}`, e.sizes);
  }
  return map;
}

function sum(files, sizes, c) {
  let n = 0;
  for (const f of files) if (sizes[f]) n += sizes[f][c];
  return n;
}

function sizesOf(js, css, sizes) {
  const out = {};
  for (const c of ['raw', 'gzip', 'brotli']) {
    const j = sum(js, sizes, c);
    const s = sum(css, sizes, c);
    out[c] = { js: j, css: s, total: j + s };
  }
  return out;
}

function pct(part, whole) {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1).replace(/\.0$/, '')}%` : 'new';
}

// Checks one build.
//   input    { mode, entries, lazy, build, sizes, maps, outside }
//            entries and lazy: [{ name, kind, js: [file], css: [file] }]; build: every JavaScript and CSS file in the folder;
//            sizes: { file: { raw, gzip, brotli, hash } } for each file that exists; maps: source map files in the folder;
//            outside: links in the folder that point outside it and were not read
//   options  budgets (from parseBudget), compression, baseline (from readBaseline), maxGrowth (from parseGrowth),
//            allowMaps, failOn, notes, sources
export function checkBuild(input, options = {}) {
  const o = { budgets: parseBudget(null), compression: null, baseline: null, maxGrowth: null, allowMaps: false, failOn: 'error', notes: [], sources: null, ...options };
  const c = o.compression || o.budgets.compression || 'gzip';
  const sizes = input.sizes || {};
  const findings = [];
  const notes = [...o.notes];
  const add = (id, severity, message, extra = {}) => findings.push({
    id, severity, name: extra.name ?? null, file: extra.file ?? null, size: extra.size ?? null, budget: extra.budget ?? null, message: safeText(message, 1200)
  });
  const show = (t) => safeText(t, 300);
  const fmt = (n) => `${formatSize(n)}`;

  // Files a manifest names that are not in the folder.
  const outside = new Set(input.outside || []);
  const users = new Map();
  for (const e of [...(input.entries || []), ...(input.lazy || [])]) {
    for (const f of [...e.js, ...e.css]) {
      if (!users.has(f)) users.set(f, []);
      if (!users.get(f).includes(e.name)) users.get(f).push(e.name);
    }
  }
  for (const f of input.referenced || []) if (!users.has(f)) users.set(f, []);
  for (const [f, by] of users) {
    if (sizes[f]) continue;
    const why = outside.has(f) ? 'is a link that points outside --dir and was not read' : 'is not in the build output folder';
    const named = by.length ? `, named by ${quoteList(by.map(show), 3)},` : '';
    add('missing-file', 'error', `${show(f)}${named} ${why}; the manifest and the folder are from different builds, or files were removed after the build`, { file: f });
  }

  // Pages.
  const noBudget = [];
  const entries = [];
  for (const e of input.entries || []) {
    const s = sizesOf(e.js, e.css, sizes);
    const cur = s[c];
    const budget = budgetFor(e.name, o.budgets);
    const over = [];
    if (budget) {
      for (const m of METRICS) {
        if (budget[m] === null || cur[m] <= budget[m]) continue;
        over.push(m);
        const what = { js: 'JS', css: 'CSS', total: 'total (JS and CSS)' }[m];
        const when = e.kind === 'file' ? '' : 'up-front ';
        add('over-budget', 'error', `${show(e.name)}: ${when}${what} is ${fmt(cur[m])} ${c}, ${fmt(cur[m] - budget[m])} (${pct(cur[m] - budget[m], budget[m])}) over the ${fmt(budget[m])} budget`, { name: e.name, size: cur[m], budget: budget[m] });
      }
    } else noBudget.push(e.name);
    entries.push({
      name: e.name, kind: e.kind, files: e.js.length + e.css.length, js: cur.js, css: cur.css, total: cur.total,
      budget: budget ? { js: budget.js, css: budget.css, total: budget.total, pattern: budget.pattern } : null,
      status: !budget ? 'no budget' : over.length ? `over: ${over.join(', ')}` : 'ok',
      growth: null, sizes: s
    });
  }
  if (noBudget.length) {
    add('no-budget', 'info', `${plural(noBudget.length, 'page')} ${noBudget.length === 1 ? 'has' : 'have'} no budget: ${quoteList(noBudget.map(show))}; add a "default" budget or a matching pattern under "entries"`);
  }

  // Chunks loaded later.
  const lazyMax = o.budgets.lazy ? o.budgets.lazy.max : null;
  const lazy = [];
  for (const l of input.lazy || []) {
    const s = sizesOf(l.js, l.css, sizes);
    const cur = s[c];
    const over = lazyMax !== null && cur.total > lazyMax;
    if (over) {
      add('lazy-over-budget', 'warning', `lazy chunk ${show(l.name)} adds ${fmt(cur.total)} ${c} when it loads, ${fmt(cur.total - lazyMax)} over the lazy.max budget of ${fmt(lazyMax)}`, { name: l.name, size: cur.total, budget: lazyMax });
    }
    lazy.push({ name: l.name, kind: 'lazy', files: l.js.length + l.css.length, js: cur.js, css: cur.css, total: cur.total, budget: lazyMax, status: lazyMax === null ? 'no budget' : over ? 'over' : 'ok', sizes: s });
  }

  // Single files.
  const build = (input.build || []).filter((f) => sizes[f]);
  const fileMax = o.budgets.files ? o.budgets.files.max : null;
  if (fileMax !== null) {
    for (const f of build) {
      const n = sizes[f][c];
      if (n > fileMax) add('file-over-budget', 'error', `${show(f)} is ${fmt(n)} ${c}, ${fmt(n - fileMax)} over the files.max budget of ${fmt(fileMax)}`, { file: f, size: n, budget: fileMax });
    }
  }

  // Growth since the baseline.
  if (o.baseline) {
    const added = [];
    const keys = new Set();
    for (const e of entries) {
      const key = `${e.kind}:${e.name}`;
      keys.add(key);
      const before = o.baseline.get(key);
      if (!before) {
        added.push(e.name);
        continue;
      }
      if (!before[c] || typeof before[c].total !== 'number') continue;
      const prev = before[c].total;
      const change = e.total - prev;
      e.growth = { previous: prev, change, percent: prev > 0 ? Number(((change / prev) * 100).toFixed(2)) : null };
      if (change <= 0) continue;
      const g = o.maxGrowth;
      const tooMuch = g !== null && (g.percent !== null ? (prev > 0 ? (change / prev) * 100 > g.percent : true) : change > g.bytes);
      add('growth', tooMuch ? 'error' : 'warning',
        `${show(e.name)} grew from ${fmt(prev)} to ${fmt(e.total)} ${c} (+${fmt(change)}, +${pct(change, prev)}) since the baseline${tooMuch ? `, more than --max-growth ${g.text}` : ''}`,
        { name: e.name, size: e.total, budget: prev });
    }
    const removed = [...o.baseline.keys()].filter((k) => !keys.has(k)).map((k) => k.slice(k.indexOf(':') + 1));
    if (added.length) notes.push(`${plural(added.length, 'page')} ${added.length === 1 ? 'is' : 'are'} not in the baseline: ${quoteList(added.map(show))}`);
    if (removed.length) notes.push(`${plural(removed.length, 'page')} of the baseline ${removed.length === 1 ? 'is' : 'are'} no longer in the build: ${quoteList(removed.map(show))}`);
  }

  // The same content shipped twice.
  const byHash = new Map();
  for (const f of build) {
    const h = sizes[f].hash;
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push(f);
  }
  for (const group of byHash.values()) {
    if (group.length < 2 || sizes[group[0]].raw === 0) continue;
    add('duplicate-chunk-content', 'info', `${plural(group.length, 'file')} have the same content (${fmt(sizes[group[0]][c])} ${c} each): ${quoteList(group.map(show))}; a page that loads more than one of them downloads the same code twice`, { file: group[0], size: sizes[group[0]][c] });
  }

  // Source maps in the folder.
  const maps = input.maps || [];
  if (maps.length && !o.allowMaps) {
    add('source-map-shipped', 'warning', `${plural(maps.length, 'source map')} in the build output folder would be deployed with it and publish the original source: ${quoteList(maps.map(show))}. Leave them out of the deploy, or pass --allow-maps when that is intended`, { file: maps[0] });
  }
  if (outside.size) notes.push(`${plural(outside.size, 'link')} in the build output point${outside.size === 1 ? 's' : ''} outside --dir and ${outside.size === 1 ? 'was' : 'were'} not followed: ${quoteList([...outside].map(show), 3)}`);

  const largest = [...build]
    .sort((a, b) => sizes[b][c] - sizes[a][c] || (a < b ? -1 : 1))
    .slice(0, 10)
    .map((f) => ({ file: f, raw: sizes[f].raw, gzip: sizes[f].gzip, brotli: sizes[f].brotli }));

  findings.sort((a, b) => RANK[a.severity] - RANK[b.severity] || ORDER[a.id] - ORDER[b.id]);
  const counts = { error: 0, warning: 0, info: 0 };
  const byCheck = Object.fromEntries(FINDINGS.map((f) => [f.id, 0]));
  for (const f of findings) {
    counts[f.severity] += 1;
    byCheck[f.id] += 1;
  }
  const failing = findings.filter((f) => meetsThreshold(f.severity, o.failOn));
  const errors = failing.filter((f) => f.severity === 'error').length;
  const warnings = failing.length - errors;
  const reason = [errors ? plural(errors, 'error') : '', warnings ? plural(warnings, 'warning') : ''].filter(Boolean).join(' and ');
  const totals = { raw: 0, gzip: 0, brotli: 0 };
  for (const f of build) for (const k of Object.keys(totals)) totals[k] += sizes[f][k];

  return {
    tool: 'bundle-budget-check',
    mode: input.mode || null,
    compression: c,
    sources: o.sources ? Object.fromEntries(Object.entries(o.sources).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, safeText(v, 300)])) : null,
    summary: {
      entries: entries.length,
      lazy: lazy.length,
      jsFiles: build.filter((f) => !/\.css$/i.test(f)).length,
      cssFiles: build.filter((f) => /\.css$/i.test(f)).length,
      sourceMaps: maps.length,
      bytes: totals
    },
    entries: entries.map((e) => ({ ...e, name: show(e.name) })),
    lazy: lazy.map((l) => ({ ...l, name: show(l.name) })),
    largest: largest.map((l) => ({ ...l, file: show(l.file) })),
    counts,
    byCheck,
    total: findings.length,
    findings: findings.map((f) => ({ ...f, name: f.name === null ? null : show(f.name), file: f.file === null ? null : show(f.file) })),
    notes: notes.map((n) => safeText(n, 1200)),
    gate: { failOn: o.failOn, pass: failing.length === 0, reason: failing.length ? reason : '' }
  };
}
