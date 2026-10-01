// Runs the README examples and checks that they report what the README shows.
// Compressed sizes come from the zlib inside Node and can differ by a few bytes between Node builds,
// so the lines checked here are the ones that do not depend on them: inputs, raw sizes, statuses, findings and the gate.

import { main } from '../src/index.js';

async function run(argv) {
  let out = '';
  const code = await main(argv, { out: (t) => { out += t; }, err: (t) => process.stderr.write(t) });
  process.stdout.write(out);
  return { code, out };
}

const problems = [];
function expect(name, result, code, expected, unwanted) {
  const missing = expected.filter((e) => !result.out.includes(e));
  const wrong = unwanted.filter((e) => result.out.includes(e));
  if (result.code !== code || missing.length || wrong.length) {
    problems.push(`${name}: unexpected report (exit code ${result.code}, expected ${code}; missing: ${missing.join(' / ') || 'none'}; should not appear: ${wrong.join(' / ') || 'none'})`);
  }
}

const dist = ['--dir', 'examples/vite-dist'];

const pass = await run([...dist, '--config', 'examples/budget.json']);
expect('budget.json', pass, 0, [
  'bundle-budget-check: Vite manifest examples/vite-dist/.vite/manifest.json, folder examples/vite-dist, budget examples/budget.json',
  'sizes: gzip; 2 pages, 2 lazy chunks; 9 JS and 4 CSS files (raw 268.22 KB, ',
  'findings: 0 error, 1 warning, 1 info',
  'Page        JS ',
  ' 170 KB / 50 KB / 220 KB    ok',
  ' 60 KB / 50 KB / 220 KB     ok',
  'Lazy chunk ',
  'src/pages/Reports.tsx ',
  'Largest files (by gzip)          raw ',
  'assets/vendor-react-9d8e7f6a.js  92.19 KB',
  'WARNING   source-map-shipped       1 source map in the build output folder would be deployed with it and publish the original source: assets/index-4f1a2b3c.js.map.',
  'INFO      duplicate-chunk-content  2 files have the same content (',
  'assets/legacy-a1b2c3d4.js, assets/legacy-e5f6a7b8.js; a page that loads more than one of them downloads the same code twice',
  'GATE: PASS (--fail-on error)'
], ['ERROR', 'no-budget', 'over-budget', 'growth']);

process.stdout.write('\n');
const tight = await run([...dist, '--config', 'examples/budget-tight.json', '--baseline', 'examples/baseline.json', '--max-growth', '5%']);
expect('budget-tight.json', tight, 1, [
  'budget examples/budget-tight.json, baseline examples/baseline.json',
  'findings: 4 error, 3 warning, 2 info',
  ' 30 KB / 5 KB / 34 KB       over: js, total  +',
  'admin.html ',
  'no budget',
  'ERROR     over-budget              index.html: up-front JS is ',
  'over the 30 KB budget',
  'ERROR     over-budget              index.html: up-front total (JS and CSS) is ',
  'over the 34 KB budget',
  'ERROR     file-over-budget         assets/vendor-react-9d8e7f6a.js is ',
  'over the files.max budget of 20 KB',
  'ERROR     growth                   index.html grew from 35 KB to ',
  'since the baseline, more than --max-growth 5%',
  'WARNING   growth                   admin.html grew from 36.7 KB to ',
  'WARNING   lazy-over-budget         lazy chunk src/pages/Reports.tsx adds ',
  'over the lazy.max budget of 15 KB',
  'WARNING   source-map-shipped ',
  'INFO      duplicate-chunk-content ',
  'INFO      no-budget                1 page has no budget: admin.html; add a "default" budget or a matching pattern under "entries"',
  '15 KB   ok\n\nLargest files (by gzip)',
  'GATE: FAIL - 4 errors'
], ['missing-file']);

if (problems.length) {
  for (const p of problems) console.error(`example: ${p}`);
  process.exit(1);
}
