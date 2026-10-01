// Command line: bundle-budget-check --dir <build output> [--manifest <file> | --next <.next folder> | --glob] [options]

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { walkBuild, readBounded, parseJson, fileKind, globBuild } from './files.js';
import { createMeasurer, COMPRESSIONS } from './size.js';
import { findViteManifest, parseViteManifest, viteBuild, VITE_MANIFEST_PATHS } from './vite.js';
import { readNextBuild } from './next.js';
import { checkBuild, parseBudget, parseGrowth, readBaseline, FINDINGS } from './check.js';
import { toText, toMarkdown, toJson, toCsv } from './report.js';

const FORMATS = { text: toText, markdown: toMarkdown, json: toJson, csv: toCsv };
const THRESHOLDS = ['error', 'warning'];

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export const USAGE = `Usage: bundle-budget-check --dir <build output> [--manifest <file> | --glob] [options]
       bundle-budget-check --next <.next folder> [options]

Checks the JavaScript and CSS each page of a front-end build loads against size budgets.
It reads the build output and its manifest; it never runs the build and opens no connection.

Options:
  --dir <folder>          the build output folder, such as dist
  --manifest <file>       the Vite manifest (default: <dir>/${VITE_MANIFEST_PATHS[0]}, then <dir>/${VITE_MANIFEST_PATHS[1]})
  --next <folder>         a Next.js .next folder: routes from build-manifest.json and
                          app-build-manifest.json, files under static/
  --glob                  no manifest: every .js and .css file in --dir is measured alone
  --config <file>         the budget file (JSON); without it every page is reported as no-budget
  --compression <name>    gzip, brotli or raw (default: the budget file's, else gzip)
  --baseline <file>       a JSON report of an earlier run, to report growth per page
  --max-growth <limit>    growth above this is an error, as a percentage (5%) or a size (10 KB)
  --allow-maps            do not warn about .map files in the build output
  --format <name>         text, markdown, json or csv (default: text)
  --fail-on <level>       exit with 1 when a finding is at this level or above: error or warning
                          (default: error)
  --help                  show this text
  --version               show the version

Sizes: B, KB (1000 bytes), MB (1000 KB), KiB (1024 bytes), MiB (1024 KiB).
Checks: ${FINDINGS.map((f) => f.id).join(', ')}

Exit codes: 0 no finding at the --fail-on level, 1 such a finding, 2 usage or input error.
`;

export function parseArgs(argv) {
  const o = {
    dir: null, manifest: null, next: null, glob: false, config: null, compression: null, baseline: null, maxGrowth: null,
    allowMaps: false, format: 'text', failOn: 'error', help: false, version: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version' || a === '-v') o.version = true;
    else if (a === '--dir') o.dir = next();
    else if (a === '--manifest') o.manifest = next();
    else if (a === '--next') o.next = next();
    else if (a === '--glob') o.glob = true;
    else if (a === '--config') o.config = next();
    else if (a === '--compression') o.compression = next();
    else if (a === '--baseline') o.baseline = next();
    else if (a === '--max-growth') o.maxGrowth = next();
    else if (a === '--allow-maps') o.allowMaps = true;
    else if (a === '--format') o.format = next();
    else if (a === '--fail-on') o.failOn = next();
    else if (a === '-') throw new Error('reading from standard input is not supported; give a folder');
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.help && !o.version) {
    if (o.next !== null && (o.glob || o.manifest !== null)) throw new Error('--next reads the Next.js manifests; do not combine it with --manifest or --glob');
    if (o.glob && o.manifest !== null) throw new Error('--glob measures files without a manifest; do not combine it with --manifest');
    if (o.next === null && o.dir === null) throw new Error('give the build output folder with --dir, or a Next.js build with --next');
    if (o.next !== null && o.dir !== null && resolve(o.dir) !== resolve(o.next)) throw new Error('with --next, files are read from that folder; leave out --dir');
    if (!FORMATS[o.format]) throw new Error(`unknown format ${o.format} (text, markdown, json or csv)`);
    if (!THRESHOLDS.includes(o.failOn)) throw new Error(`--fail-on takes error or warning, not ${o.failOn}`);
    if (o.compression !== null && !COMPRESSIONS.includes(o.compression)) throw new Error(`--compression takes gzip, brotli or raw, not ${o.compression}`);
    if (o.maxGrowth !== null && o.baseline === null) throw new Error('--max-growth needs a --baseline report to compare with');
    if (o.maxGrowth !== null) o.maxGrowth = parseGrowth(o.maxGrowth);
    for (const p of [o.dir, o.manifest, o.next, o.config, o.baseline]) {
      if (p !== null && /^[a-z][a-z0-9+.-]*:\/\//i.test(p)) throw new Error('give local files and folders; the tool never fetches a URL');
    }
  }
  return o;
}

// Reads the inputs, measures the files and checks them. Throws on an input error.
async function run(o) {
  const budgets = o.config === null ? parseBudget(null) : parseBudget(parseJson(await readBounded(o.config), o.config));
  const baseline = o.baseline === null ? null : readBaseline(parseJson(await readBounded(o.baseline), o.baseline));
  const root = o.next ?? o.dir;
  let plan;
  let manifest = null;
  if (o.next !== null) plan = await readNextBuild(o.next);
  else if (!o.glob) {
    manifest = o.manifest ?? (await findViteManifest(o.dir));
    if (manifest === null) {
      throw new Error(`no Vite manifest at ${o.dir}/${VITE_MANIFEST_PATHS[0]} or ${o.dir}/${VITE_MANIFEST_PATHS[1]}; build with build.manifest: true, or give --manifest, --next or --glob`);
    }
    plan = viteBuild(parseViteManifest(parseJson(await readBounded(manifest), manifest), manifest));
  }
  const walk = await walkBuild(root, o.next !== null ? 'static' : '');
  if (o.glob) plan = globBuild(walk.files);
  const build = walk.files.filter((f) => fileKind(f.rel)).map((f) => f.rel);
  const maps = walk.files.filter((f) => /\.map$/i.test(f.rel)).map((f) => f.rel);
  const measurer = createMeasurer(root);
  const sizes = {};
  for (const rel of build) sizes[rel] = await measurer.measure(rel);
  const notes = [...plan.notes];
  if (walk.linkedDirs.length) notes.push(`${walk.linkedDirs.length} link(s) to folders in the build output were not followed: ${walk.linkedDirs.slice(0, 3).join(', ')}`);
  return checkBuild(
    { mode: plan.mode, entries: plan.entries, lazy: plan.lazy, referenced: plan.referenced, build, sizes, maps, outside: walk.outside },
    {
      budgets, compression: o.compression, baseline, maxGrowth: o.maxGrowth, allowMaps: o.allowMaps, failOn: o.failOn, notes,
      sources: { dir: o.next === null ? o.dir : null, manifest, next: o.next, config: o.config, baseline: o.baseline }
    }
  );
}

// Exit code: 0 no finding at the --fail-on level, 1 such a finding, 2 usage or input error.
export async function main(argv, io = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (error) {
    io.err(`bundle-budget-check: ${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (o.help) {
    io.out(USAGE);
    return 0;
  }
  if (o.version) {
    io.out(`${VERSION}\n`);
    return 0;
  }
  let report;
  try {
    report = await run(o);
  } catch (error) {
    io.err(`bundle-budget-check: ${error.code === 'ENOENT' ? `${error.path}: no such file or folder` : error.message}\n`);
    return 2;
  }
  io.out(FORMATS[o.format](report));
  return report.gate.pass ? 0 : 1;
}
