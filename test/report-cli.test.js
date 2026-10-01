import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { parseArgs, main, checkBuild, parseBudget, toText, toMarkdown, toJson, toCsv, csvCell, mdCell, USAGE, VERSION } from '../src/index.js';
import { withBuild, filler } from './helpers.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const at = (p) => join(root, p).split('\\').join('/');
const quiet = { out: () => {}, err: () => {} };

async function capture(argv) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (t) => { out += t; }, err: (t) => { err += t; } });
  return { code, out, err };
}

const dist = ['--dir', at('examples/vite-dist')];
const passRun = [...dist, '--config', at('examples/budget.json')];
const tightRun = [...dist, '--config', at('examples/budget-tight.json'), '--baseline', at('examples/baseline.json'), '--max-growth', '5%'];

// A report with text that tries to break each format.
function hostile() {
  const sizes = { '=cmd|x.js': { raw: 10, gzip: 5, brotli: 4, hash: 'a' } };
  return checkBuild({ mode: 'glob', entries: [{ name: '=cmd|x.js', kind: 'file', js: ['=cmd|x.js'], css: [] }], build: ['=cmd|x.js'], sizes, maps: ['@evil\nline.map'] }, { budgets: parseBudget({ default: { js: 1 } }) });
}

test('parseArgs reads options and refuses bad input', () => {
  const o = parseArgs(['--dir', 'dist', '--manifest', 'm.json', '--config', 'b.json', '--compression', 'brotli', '--baseline', 'old.json',
    '--max-growth', '10 KB', '--allow-maps', '--format', 'csv', '--fail-on', 'warning']);
  assert.deepEqual([o.dir, o.manifest, o.config, o.compression, o.baseline, o.format, o.failOn, o.allowMaps], ['dist', 'm.json', 'b.json', 'brotli', 'old.json', 'csv', 'warning', true]);
  assert.deepEqual(o.maxGrowth, { percent: null, bytes: 10_000, text: '10 KB' });
  const d = parseArgs(['--dir', 'dist']);
  assert.deepEqual([d.format, d.failOn, d.compression, d.glob, d.next, d.allowMaps], ['text', 'error', null, false, null, false]);
  assert.equal(parseArgs(['--next', '.next']).next, '.next');
  assert.equal(parseArgs(['--dir', 'dist', '--glob']).glob, true);
  assert.throws(() => parseArgs([]), /--dir/);
  assert.throws(() => parseArgs(['--next', '.next', '--glob']), /do not combine/);
  assert.throws(() => parseArgs(['--next', '.next', '--manifest', 'm.json']), /do not combine/);
  assert.throws(() => parseArgs(['--dir', 'd', '--glob', '--manifest', 'm.json']), /do not combine/);
  assert.throws(() => parseArgs(['--next', '.next', '--dir', 'dist']), /leave out --dir/);
  assert.throws(() => parseArgs(['--dir', 'd', '--format', 'xml']), /unknown format xml/);
  assert.throws(() => parseArgs(['--dir', 'd', '--fail-on', 'info']), /error or warning/);
  assert.throws(() => parseArgs(['--dir', 'd', '--compression', 'zstd']), /gzip, brotli or raw/);
  assert.throws(() => parseArgs(['--dir', 'd', '--max-growth', '5%']), /needs a --baseline/);
  assert.throws(() => parseArgs(['--dir', 'd', '--baseline', 'b.json', '--max-growth', 'much']), /--max-growth/);
  assert.throws(() => parseArgs(['--dir', 'https://cdn.example.com/dist']), /never fetches a URL/);
  assert.throws(() => parseArgs(['--dir']), /needs a value/);
  assert.throws(() => parseArgs(['--dir', 'd', '--build']), /unknown argument --build/);
  assert.throws(() => parseArgs(['-']), /standard input/);
});

test('exit codes: 0 within budget, 1 on errors or with --fail-on warning, 2 on usage or input errors', async () => {
  assert.equal(await main(passRun, quiet), 0);
  assert.equal(await main([...passRun, '--fail-on', 'warning'], quiet), 1);
  assert.equal(await main([...passRun, '--fail-on', 'warning', '--allow-maps'], quiet), 0);
  assert.equal(await main(tightRun, quiet), 1);
  assert.equal(await main(['--nope'], quiet), 2);
  assert.equal(await main(['--help'], quiet), 0);
  const v = await capture(['--version']);
  assert.equal(v.out.trim(), VERSION);
  const missing = await capture(['--dir', at('examples/none')]);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /no Vite manifest at .*examples\/none\/\.vite\/manifest\.json/);
  const badConfig = await capture([...dist, '--config', at('examples/vite-dist/.vite/manifest.json')]);
  assert.equal(badConfig.code, 2);
  assert.match(badConfig.err, /budget file: unknown key "index\.html"/);
  const badBaseline = await capture([...dist, '--baseline', at('examples/budget.json')]);
  assert.equal(badBaseline.code, 2);
  assert.match(badBaseline.err, /not a JSON report of bundle-budget-check/);
  const usage = await capture(['--format', 'json']);
  assert.ok(usage.err.includes(USAGE));
});

test('the passing example: tables per page, lazy chunks and the largest files, then the gate', async () => {
  const { code, out } = await capture(passRun);
  assert.equal(code, 0);
  assert.ok(out.startsWith(`bundle-budget-check: Vite manifest ${at('examples/vite-dist')}/.vite/manifest.json, folder ${at('examples/vite-dist')}, budget ${at('examples/budget.json')}\n`));
  assert.match(out, /\nsizes: gzip; 2 pages, 2 lazy chunks; 9 JS and 4 CSS files \(raw 268\.22 KB, gzip [\d.]+ KB, brotli [\d.]+ KB\); 1 source map\n/);
  assert.match(out, /\nfindings: 0 error, 1 warning, 1 info\n/);
  assert.match(out, /\nPage +JS +CSS +Total +Budget \(JS \/ CSS \/ total\) +Status\n/);
  assert.match(out, /\nindex\.html +[\d.]+ KB +[\d.]+ KB +[\d.]+ KB +170 KB \/ 50 KB \/ 220 KB +ok\n/);
  assert.match(out, /\nadmin\.html +[\d.]+ KB +[\d.]+ KB +[\d.]+ KB +60 KB \/ 50 KB \/ 220 KB +ok\n/);
  assert.match(out, /\nsrc\/pages\/Reports\.tsx  .* 120 KB +ok\n/);
  assert.match(out, /\nLargest files \(by gzip\) +raw +gzip +brotli\nassets\/vendor-react-9d8e7f6a\.js /);
  assert.match(out, /GATE: PASS \(--fail-on error\)\n$/);
});

test('JSON output holds the whole report and works as the next --baseline', async () => {
  const { code, out } = await capture([...passRun, '--format', 'json']);
  assert.equal(code, 0);
  const rep = JSON.parse(out);
  assert.equal(rep.tool, 'bundle-budget-check');
  assert.equal(rep.mode, 'vite');
  assert.deepEqual(rep.counts, { error: 0, warning: 1, info: 1 });
  assert.deepEqual(rep.entries.map((e) => [e.name, e.kind, e.files]), [['index.html', 'entry', 5], ['admin.html', 'entry', 5]]);
  assert.deepEqual(rep.lazy.map((l) => [l.name, l.files]), [['src/pages/Reports.tsx', 3], ['src/pages/Settings.tsx', 1]]);
  assert.equal(rep.largest.length, 10);
  assert.equal(toJson(rep), `${JSON.stringify(rep, null, 2)}\n`);
  await withBuild({ 'report.json': out }, async (dir) => {
    const again = await capture([...passRun, '--baseline', join(dir, 'report.json'), '--max-growth', '0%', '--format', 'json']);
    assert.equal(again.code, 0, 'the same build has not grown');
    const second = JSON.parse(again.out);
    assert.deepEqual(second.entries.map((e) => e.growth.change), [0, 0]);
    assert.equal(second.byCheck.growth, 0);
  });
});

test('the tight example fails on every kind of budget and on growth', async () => {
  const { code, out } = await capture([...tightRun, '--format', 'json']);
  assert.equal(code, 1);
  const rep = JSON.parse(out);
  assert.deepEqual(rep.byCheck, { 'over-budget': 2, 'file-over-budget': 1, 'missing-file': 0, growth: 2, 'lazy-over-budget': 1, 'source-map-shipped': 1, 'duplicate-chunk-content': 1, 'no-budget': 1 });
  assert.deepEqual(rep.findings.filter((f) => f.id === 'growth').map((f) => f.severity), ['error', 'warning']);
  assert.equal(rep.gate.reason, '4 errors');
});

test('Markdown escapes pipes and line breaks so build output names cannot break a table', async () => {
  assert.equal(mdCell('a|b\nc\\d'), 'a\\|b c\\\\d');
  const md = toMarkdown(hostile());
  assert.match(md, /^## bundle-budget-check: 1 error, 1 warning, 0 info/);
  for (const line of md.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| ---'))) {
    const cells = line.replace(/\\\|/g, '').split('|').length;
    assert.ok([5, 6, 8].includes(cells), line);
  }
  assert.ok(!md.includes('@evil\nline'));
  const { out } = await capture([...tightRun, '--format', 'markdown']);
  assert.match(out, /\n\| Page \| JS \| CSS \| Total \| Budget \(JS \/ CSS \/ total\) \| Status \| Growth \|\n\| --- \|/);
  assert.match(out, /\| error \| over-budget \| index\.html: up-front JS is /);
  assert.match(out, /\*\*Gate failed:\*\* 4 errors\./);
});

test('CSV follows RFC 4180 and defuses formulas', async () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=1+2'), "'=1+2");
  assert.equal(csvCell('-x'), "'-x");
  assert.equal(csvCell('+x'), "'+x");
  assert.equal(csvCell('@x'), "'@x");
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(7), '7');
  const lines = toCsv(hostile()).split('\r\n');
  assert.equal(lines[0], 'type,severity,id,name,js,css,total,budget_js,budget_css,budget_total,status,message');
  assert.equal(lines[1], "file,,,'=cmd|x.js,5,0,5,1,,,over: js,");
  assert.ok(lines.some((l) => l.startsWith("finding,warning,source-map-shipped,'@evil line.map,")));
  const { out } = await capture([...tightRun, '--format', 'csv']);
  assert.match(out, /\r\npage,,,index\.html,\d+,\d+,\d+,30000,5000,34000,"over: js, total",\r\n/);
  assert.match(out, /\r\nlazy,,,src\/pages\/Reports\.tsx,\d+,\d+,\d+,,,15000,over,\r\n/);
  assert.ok(out.endsWith('\r\n'));
});

test('text output keeps every finding on one line and shows notes', () => {
  const text = toText(hostile());
  assert.ok(!/[\u0000-\u0008\u000b-\u001f]/.test(text));
  assert.match(text, /\nWARNING   source-map-shipped       1 source map in the build output folder would be deployed with it and publish the original source: @evil line\.map\./);
  const empty = checkBuild({ mode: 'glob', entries: [], build: [], sizes: {} }, { notes: ['the folder holds no JavaScript or CSS file'] });
  assert.match(toText(empty), /\nno findings\n\nnote: the folder holds no JavaScript or CSS file\n\nGATE: PASS \(--fail-on error\)\n$/);
});

test('--glob measures every JavaScript and CSS file alone, with patterns over file paths', async () => {
  await withBuild({ 'assets/app.js': filler(30_000), 'assets/app.css': filler(4000, 3), 'assets/vendor.js': filler(90_000, 5), 'index.html': '<html></html>' }, async (dir) => {
    await writeFile(join(dir, 'budget.json'), JSON.stringify({ compression: 'raw', default: { js: '50 KB', css: '10 KB' }, entries: { 'assets/vendor*.js': { js: '100 KB' } } }));
    const ok = await capture(['--dir', dir, '--glob', '--config', join(dir, 'budget.json'), '--format', 'json']);
    assert.equal(ok.code, 0);
    const rep = JSON.parse(ok.out);
    assert.equal(rep.mode, 'glob');
    assert.deepEqual(rep.entries.map((e) => [e.name, e.kind, e.total, e.status]), [['assets/app.css', 'file', 4000, 'ok'], ['assets/app.js', 'file', 30_000, 'ok'], ['assets/vendor.js', 'file', 90_000, 'ok']]);
    const tight = await capture(['--dir', dir, '--glob', '--config', join(dir, 'budget.json'), '--compression', 'raw']);
    assert.match(tight.out, /\nFile +JS/);
    await writeFile(join(dir, 'budget.json'), JSON.stringify({ compression: 'raw', default: { js: '20 KB' } }));
    const fail = await capture(['--dir', dir, '--glob', '--config', join(dir, 'budget.json')]);
    assert.equal(fail.code, 1);
    assert.match(fail.out, /ERROR {5}over-budget {14}assets\/app\.js: JS is 30 KB raw, 10 KB \(50%\) over the 20 KB budget/);
  });
});

test('--next reads the routes of a .next folder and the files under static/', async () => {
  const files = {
    'build-manifest.json': { rootMainFiles: ['static/chunks/main-app.js'], pages: { '/': ['static/chunks/main.js', 'static/chunks/pages/index.js'], '/_app': ['static/chunks/pages/_app.js'] } },
    'app-build-manifest.json': { pages: { '/layout': ['static/css/layout.css'], '/shop/page': ['static/chunks/app/shop/page.js'] } },
    'static/chunks/main.js': filler(9000),
    'static/chunks/main-app.js': filler(8000, 2),
    'static/chunks/pages/index.js': filler(3000, 3),
    'static/chunks/pages/_app.js': filler(1800, 4),
    'static/css/layout.css': filler(1500, 6),
    'server/app/shop/page.js': filler(50_000, 7)
  };
  await withBuild(files, async (dir) => {
    const { code, out } = await capture(['--next', dir, '--compression', 'raw', '--format', 'json']);
    assert.equal(code, 1, 'the app page chunk is missing');
    const rep = JSON.parse(out);
    assert.equal(rep.mode, 'next');
    assert.deepEqual(rep.entries.map((e) => [e.name, e.kind, e.total]), [['/', 'pages', 13_800], ['/shop', 'app', 9500]]);
    assert.deepEqual(rep.findings.filter((f) => f.id === 'missing-file').map((f) => f.file), ['static/chunks/app/shop/page.js']);
    assert.equal(rep.summary.jsFiles, 4, 'server/ files are not counted');
    const text = await capture(['--next', dir]);
    assert.match(text.out, /\nRoute +JS/);
    assert.match(text.out, /\n\/shop \(app\) /);
  });
});

test('a manifest that names a file outside --dir stops the run with exit code 2', async () => {
  const manifest = { 'index.html': { file: '../outside/secret.js', isEntry: true } };
  await withBuild({ '.vite/manifest.json': manifest, 'assets/a.js': 'a' }, async (dir) => {
    const { code, err } = await capture(['--dir', dir]);
    assert.equal(code, 2);
    assert.match(err, /manifest path "\.\.\/outside\/secret\.js" escapes --dir/);
  });
  await withBuild({ 'manifest.json': { 'index.html': { file: '/etc/passwd', isEntry: true } } }, async (dir) => {
    const { code, err } = await capture(['--dir', dir]);
    assert.equal(code, 2);
    assert.match(err, /is absolute/);
  });
});
