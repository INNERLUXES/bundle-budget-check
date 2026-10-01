import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkBuild, FINDINGS, SEVERITIES, RANK, METRICS, isFindingId, safeText, meetsThreshold,
  globToRegExp, parseBudget, budgetFor, parseGrowth, readBaseline
} from '../src/index.js';

// Sizes written by hand: gzip is a quarter of raw and brotli a fifth, so every number can be worked out.
function sz(raw, hash = null) {
  return { raw, gzip: raw / 4, brotli: raw / 5, hash: hash ?? `h-${raw}-${Math.random()}` };
}
const sizes = {
  'assets/index.js': sz(40_000),
  'assets/vendor.js': sz(400_000),
  'assets/index.css': sz(20_000),
  'assets/admin.js': sz(80_000),
  'assets/lazy.js': sz(200_000)
};
const entries = [
  { name: 'index.html', kind: 'entry', js: ['assets/index.js', 'assets/vendor.js'], css: ['assets/index.css'] },
  { name: 'admin.html', kind: 'entry', js: ['assets/admin.js', 'assets/vendor.js'], css: [] }
];
const build = Object.keys(sizes);
const input = (extra = {}) => ({ mode: 'vite', entries, lazy: [], build, sizes, maps: [], ...extra });
const ids = (rep) => rep.findings.map((f) => f.id);
const find = (rep, id) => rep.findings.filter((f) => f.id === id);
const budget = (b) => parseBudget(b);

test('every check has an id and known severities, and the list is complete', () => {
  assert.deepEqual(FINDINGS.map((f) => f.id), ['over-budget', 'file-over-budget', 'missing-file', 'growth', 'lazy-over-budget', 'source-map-shipped', 'duplicate-chunk-content', 'no-budget']);
  for (const f of FINDINGS) for (const s of f.severity.split(' / ')) assert.ok(SEVERITIES.includes(s), f.id);
  assert.ok(isFindingId('growth'));
  assert.ok(!isFindingId('nothing'));
  assert.ok(RANK.error < RANK.warning && RANK.warning < RANK.info);
  assert.ok(meetsThreshold('error', 'warning'));
  assert.ok(!meetsThreshold('warning', 'error'));
  assert.ok(!meetsThreshold('info', 'warning'));
  assert.deepEqual(METRICS, ['js', 'css', 'total']);
});

test('a build within its budgets passes and reports the up-front size of each page', () => {
  const rep = checkBuild(input(), { budgets: budget({ default: { js: '170 KB', css: '50 KB', total: '220 KB' } }) });
  assert.deepEqual(ids(rep), []);
  assert.equal(rep.gate.pass, true);
  assert.equal(rep.compression, 'gzip');
  const index = rep.entries[0];
  assert.deepEqual([index.js, index.css, index.total, index.status], [110_000, 5000, 115_000, 'ok']);
  assert.deepEqual(index.sizes.raw, { js: 440_000, css: 20_000, total: 460_000 });
  assert.deepEqual(index.budget, { js: 170_000, css: 50_000, total: 220_000, pattern: 'default' });
  assert.deepEqual(rep.summary, { entries: 2, lazy: 0, jsFiles: 4, cssFiles: 1, sourceMaps: 0, bytes: { raw: 740_000, gzip: 185_000, brotli: 148_000 } });
});

test('over-budget: JS, CSS and the total are each checked, with size, budget and how much over', () => {
  const rep = checkBuild(input(), { budgets: budget({ default: { js: '100 KB', css: '4 KB', total: '112 KB' } }) });
  const over = find(rep, 'over-budget');
  assert.equal(over.length, 5);
  assert.equal(over[0].message, 'index.html: up-front JS is 110 KB gzip, 10 KB (10%) over the 100 KB budget');
  assert.equal(over[1].message, 'index.html: up-front CSS is 5 KB gzip, 1 KB (25%) over the 4 KB budget');
  assert.equal(over[2].message, 'index.html: up-front total (JS and CSS) is 115 KB gzip, 3 KB (2.7%) over the 112 KB budget');
  assert.match(over[3].message, /^admin\.html: up-front JS is 120 KB gzip, 20 KB \(20%\) over the 100 KB budget$/);
  assert.deepEqual([over[0].size, over[0].budget, over[0].name], [110_000, 100_000, 'index.html']);
  assert.equal(rep.entries[0].status, 'over: js, css, total');
  assert.equal(rep.gate.pass, false);
  assert.equal(rep.gate.reason, '5 errors');
});

test('the compression of the budget file is used, and --compression overrides it', () => {
  const b = budget({ compression: 'brotli', default: { js: '90 KB' } });
  assert.equal(checkBuild(input(), { budgets: b }).entries[0].js, 88_000);
  assert.deepEqual(ids(checkBuild(input(), { budgets: b })), ['over-budget']);
  const raw = checkBuild(input(), { budgets: b, compression: 'raw' });
  assert.equal(raw.compression, 'raw');
  assert.equal(raw.entries[0].js, 440_000);
});

test('file-over-budget: a single file larger than files.max is an error', () => {
  const rep = checkBuild(input(), { budgets: budget({ files: { max: '60 KB' } }) });
  const f = find(rep, 'file-over-budget');
  assert.deepEqual(f.map((x) => x.file), ['assets/vendor.js']);
  assert.equal(f[0].message, 'assets/vendor.js is 100 KB gzip, 40 KB over the files.max budget of 60 KB');
  assert.equal(f[0].severity, 'error');
});

test('lazy-over-budget: a lazy chunk above lazy.max is a warning that does not fail the default gate', () => {
  const lazy = [{ name: 'src/Report.tsx', kind: 'lazy', js: ['assets/lazy.js'], css: [] }];
  const rep = checkBuild(input({ lazy }), { budgets: budget({ lazy: { max: '40 KB' } }) });
  const l = find(rep, 'lazy-over-budget');
  assert.equal(l[0].severity, 'warning');
  assert.equal(l[0].message, 'lazy chunk src/Report.tsx adds 50 KB gzip when it loads, 10 KB over the lazy.max budget of 40 KB');
  assert.deepEqual([rep.lazy[0].total, rep.lazy[0].budget, rep.lazy[0].status], [50_000, 40_000, 'over']);
  assert.equal(rep.gate.pass, true);
  assert.equal(checkBuild(input({ lazy }), { budgets: budget({ lazy: { max: '40 KB' } }), failOn: 'warning' }).gate.reason, '1 warning');
});

test('missing-file: a file the manifest names that is not in the folder is an error, with the pages that need it', () => {
  const rep = checkBuild(input({
    entries: [...entries, { name: 'shop.html', kind: 'entry', js: ['assets/gone.js'], css: [] }],
    referenced: ['assets/also-gone.css'],
    outside: ['assets/linked.js'],
    lazy: [{ name: 'x', kind: 'lazy', js: ['assets/linked.js'], css: [] }]
  }));
  const m = find(rep, 'missing-file');
  assert.deepEqual(m.map((f) => f.file), ['assets/gone.js', 'assets/linked.js', 'assets/also-gone.css']);
  assert.match(m[0].message, /^assets\/gone\.js, named by shop\.html, is not in the build output folder/);
  assert.match(m[1].message, /is a link that points outside --dir and was not read/);
  assert.match(m[2].message, /^assets\/also-gone\.css is not in the build output folder/);
  assert.equal(rep.entries[2].total, 0);
  assert.match(rep.notes[0], /1 link in the build output points outside --dir and was not followed: assets\/linked\.js/);
});

test('no-budget: pages without a budget are listed in one info finding', () => {
  const rep = checkBuild(input(), { budgets: budget({ entries: { 'index.html': { js: '200 KB' } } }) });
  const n = find(rep, 'no-budget');
  assert.equal(n.length, 1);
  assert.equal(n[0].message, '1 page has no budget: admin.html; add a "default" budget or a matching pattern under "entries"');
  assert.equal(rep.entries[1].status, 'no budget');
  assert.equal(rep.entries[1].budget, null);
  assert.ok(find(checkBuild(input()), 'no-budget')[0].message.startsWith('2 pages have no budget: index.html, admin.html;'));
});

test('duplicate-chunk-content: files with the same content hash are reported once per group', () => {
  const dup = { ...sizes, 'assets/a.js': sz(1000, 'same'), 'assets/b.js': sz(1000, 'same'), 'assets/empty1.js': sz(0, 'e'), 'assets/empty2.js': sz(0, 'e') };
  const rep = checkBuild(input({ sizes: dup, build: Object.keys(dup) }));
  const d = find(rep, 'duplicate-chunk-content');
  assert.equal(d.length, 1, 'empty files are not reported');
  assert.equal(d[0].severity, 'info');
  assert.equal(d[0].message, '2 files have the same content (250 B gzip each): assets/a.js, assets/b.js; a page that loads more than one of them downloads the same code twice');
});

test('source-map-shipped: .map files in the output are a warning unless --allow-maps', () => {
  const maps = ['assets/index.js.map', 'assets/vendor.js.map'];
  const rep = checkBuild(input({ maps }));
  const s = find(rep, 'source-map-shipped');
  assert.equal(s[0].severity, 'warning');
  assert.match(s[0].message, /^2 source maps in the build output folder would be deployed with it and publish the original source: assets\/index\.js\.map, assets\/vendor\.js\.map\./);
  assert.equal(rep.summary.sourceMaps, 2);
  assert.deepEqual(find(checkBuild(input({ maps }), { allowMaps: true }), 'source-map-shipped'), []);
});

test('the largest files are listed, at most ten, by the chosen compression', () => {
  const many = {};
  for (let i = 1; i <= 12; i += 1) many[`f${String(i).padStart(2, '0')}.js`] = sz(i * 1000);
  const rep = checkBuild({ mode: 'glob', entries: [], build: Object.keys(many), sizes: many });
  assert.equal(rep.largest.length, 10);
  assert.deepEqual(rep.largest[0], { file: 'f12.js', raw: 12_000, gzip: 3000, brotli: 2400 });
  assert.equal(rep.largest[9].file, 'f03.js');
});

test('globToRegExp and budgetFor: exact name first, then the first matching pattern, gaps filled from default', () => {
  assert.ok(globToRegExp('/blog/*').test('/blog/[slug]'));
  assert.ok(!globToRegExp('/blog/*').test('/blog/a/b'));
  assert.ok(globToRegExp('/docs/**').test('/docs/a/b/c'));
  assert.ok(globToRegExp('*.html').test('admin.html'));
  assert.ok(!globToRegExp('a.html').test('aXhtml'), 'a dot matches only a dot');
  assert.ok(globToRegExp('(group)/[id]+').test('(group)/[id]+'));
  const b = budget({
    default: { js: '170 KB', css: '50 KB', total: '220 KB' },
    entries: { '*.html': { js: '100 KB' }, 'admin.html': { js: '60 KB', css: null } }
  });
  assert.deepEqual(budgetFor('admin.html', b), { pattern: 'admin.html', js: 60_000, css: 50_000, total: 220_000 });
  assert.deepEqual(budgetFor('index.html', b), { pattern: '*.html', js: 100_000, css: 50_000, total: 220_000 });
  assert.deepEqual(budgetFor('/route', b), { pattern: 'default', js: 170_000, css: 50_000, total: 220_000 });
  assert.equal(budgetFor('/route', budget({ entries: { '/other': { js: 1 } } })), null);
  assert.equal(budgetFor('x', budget(null)), null);
});

test('parseBudget refuses unknown keys, bad sizes and a bad compression', () => {
  assert.throws(() => parseBudget({ budgets: {} }), /unknown key "budgets"/);
  assert.throws(() => parseBudget({ default: { javascript: '1 KB' } }), /unknown key "javascript" in default/);
  assert.throws(() => parseBudget({ default: { js: '1 GB' } }), /default\.js/);
  assert.throws(() => parseBudget({ files: { max: 'big' } }), /files\.max/);
  assert.throws(() => parseBudget({ compression: 'zstd' }), /gzip, brotli or raw/);
  assert.throws(() => parseBudget({ entries: [] }), /object of patterns/);
  assert.throws(() => parseBudget({ lazy: 5 }), /lazy must be an object/);
  assert.throws(() => parseBudget([]), /expected an object/);
  assert.deepEqual(parseBudget({ lazy: { max: '120 KiB' } }).lazy, { max: 122_880 });
});

test('growth: a page that grew since the baseline is a warning, and an error above --max-growth', () => {
  const before = { tool: 'bundle-budget-check', entries: [
    { name: 'index.html', kind: 'entry', sizes: { gzip: { js: 100_000, css: 5000, total: 105_000 } } },
    { name: 'admin.html', kind: 'entry', sizes: { gzip: { js: 119_000, css: 0, total: 119_000 } } },
    { name: 'old.html', kind: 'entry', sizes: { gzip: { js: 1, css: 0, total: 1 } } }
  ] };
  const baseline = readBaseline(before);
  const warn = checkBuild(input(), { baseline });
  const g = find(warn, 'growth');
  assert.deepEqual(g.map((f) => f.severity), ['warning', 'warning']);
  assert.equal(g[0].message, 'index.html grew from 105 KB to 115 KB gzip (+10 KB, +9.5%) since the baseline');
  assert.deepEqual(warn.entries[0].growth, { previous: 105_000, change: 10_000, percent: 9.52 });
  assert.match(warn.notes.join('\n'), /1 page of the baseline is no longer in the build: old\.html/);
  const pct = checkBuild(input(), { baseline, maxGrowth: parseGrowth('5%') });
  assert.deepEqual(find(pct, 'growth').map((f) => f.severity), ['error', 'warning']);
  assert.match(find(pct, 'growth')[0].message, /, more than --max-growth 5%$/);
  const bytes = checkBuild(input(), { baseline, maxGrowth: parseGrowth('500 B') });
  assert.deepEqual(find(bytes, 'growth').map((f) => f.severity), ['error', 'error']);
  const shrink = readBaseline({ tool: 'bundle-budget-check', entries: [{ name: 'index.html', kind: 'entry', sizes: { gzip: { total: 200_000 } } }] });
  const s = checkBuild(input(), { baseline: shrink });
  assert.deepEqual(find(s, 'growth'), []);
  assert.equal(s.entries[0].growth.change, -85_000);
  assert.match(s.notes.join('\n'), /1 page is not in the baseline: admin\.html/);
});

test('parseGrowth and readBaseline accept only what they can compare', () => {
  assert.deepEqual(parseGrowth('5%'), { percent: 5, bytes: null, text: '5%' });
  assert.deepEqual(parseGrowth('2.5 %'), { percent: 2.5, bytes: null, text: '2.5%' });
  assert.deepEqual(parseGrowth('10 KB'), { percent: null, bytes: 10_000, text: '10 KB' });
  assert.equal(parseGrowth(null), null);
  assert.throws(() => parseGrowth('lots'), /--max-growth/);
  assert.throws(() => readBaseline({ tool: 'other', entries: [] }), /not a JSON report of bundle-budget-check/);
  assert.throws(() => readBaseline([]), /not a JSON report/);
  assert.equal(readBaseline({ tool: 'bundle-budget-check', entries: [null, { name: 'a' }] }).size, 0);
});

test('safeText removes control and direction characters and caps the length', () => {
  const rtl = String.fromCharCode(0x202e);
  const sep = String.fromCharCode(0x2028);
  assert.equal(safeText(`a${rtl}b\u001b[2J${sep}c`), 'a b [2J c');
  assert.equal(safeText('x'.repeat(400)).length, 300);
  assert.ok(safeText('x'.repeat(400)).endsWith('...'));
  const rep = checkBuild(input({ entries: [{ name: `evil\u001b]0;${rtl}.html`, kind: 'entry', js: [], css: [] }] }));
  assert.equal(rep.entries[0].name, 'evil ]0; .html');
  assert.ok(!/[\u0000-\u001f]/.test(JSON.stringify(rep.findings.map((f) => f.message))));
});
