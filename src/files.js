// Reads the build output folder safely: paths from a manifest must stay inside it, links that point
// outside it are never followed, and every file and the number of files are bounded.

import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

export const LIMITS = {
  maxFileBytes: 50 * 1024 * 1024,
  maxFiles: 20_000
};

const SCRIPT = /\.(?:js|mjs|cjs)$/i;
const STYLE = /\.css$/i;

// js, css or null, from the file name.
export function fileKind(rel) {
  if (SCRIPT.test(rel)) return 'js';
  if (STYLE.test(rel)) return 'css';
  return null;
}

function mb(bytes) {
  return `${bytes / 1024 / 1024} MB`;
}

// A path from a manifest, checked and written with forward slashes.
// Absolute paths, drive letters, "..", empty parts and NUL characters are refused: a manifest may not name a file outside --dir.
export function insidePath(value) {
  if (typeof value !== 'string' || value === '') throw new Error('a manifest names an empty or non-text file path');
  const shown = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '?').slice(0, 200);
  if (value.includes('\u0000')) throw new Error(`manifest path "${shown}" holds a NUL character`);
  if (/^[\\/]/.test(value) || /^[A-Za-z]:/.test(value) || isAbsolute(value) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
    throw new Error(`manifest path "${shown}" is absolute; only paths inside --dir are read`);
  }
  const parts = value.split(/[\\/]/).filter((p) => p !== '' && p !== '.');
  if (parts.includes('..')) throw new Error(`manifest path "${shown}" escapes --dir with ..`);
  if (!parts.length) throw new Error(`manifest path "${shown}" names no file`);
  return parts.join('/');
}

function within(root, target) {
  const r = relative(root, target);
  return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r));
}

// Lists the files under root/start (start is a path inside root, '' for all of it).
// Returns { root, files: [{ rel, bytes }], outside: [rel], linkedDirs: [rel] }; rel is relative to root with forward slashes.
// A link is followed only when it points to a file inside root; links to folders are not followed, so a loop of links cannot run.
export async function walkBuild(root, start = '', limits = LIMITS) {
  const info = await stat(root);
  if (!info.isDirectory()) throw new Error(`${root}: not a folder`);
  const realRoot = await realpath(root);
  const files = [];
  const outside = [];
  const linkedDirs = [];
  let seen = 0;
  const first = start ? insidePath(start) : '';
  try {
    const s = await stat(join(root, first));
    if (!s.isDirectory()) return { root: realRoot, files, outside, linkedDirs };
  } catch (error) {
    if (error.code === 'ENOENT') return { root: realRoot, files, outside, linkedDirs };
    throw error;
  }
  const stack = [first];
  while (stack.length) {
    const dir = stack.pop();
    const entries = await readdir(join(root, dir), { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      const full = join(root, rel);
      seen += 1;
      if (seen > limits.maxFiles) throw new Error(`more than ${limits.maxFiles.toLocaleString('en-US')} files in the build output, which is over the limit; point --dir at the folder that is deployed`);
      if (entry.isDirectory()) {
        stack.push(rel);
        continue;
      }
      let target = full;
      if (entry.isSymbolicLink()) {
        let real;
        try {
          real = await realpath(full);
        } catch {
          outside.push(rel);
          continue;
        }
        if (!within(realRoot, real)) {
          outside.push(rel);
          continue;
        }
        const t = await stat(real);
        if (t.isDirectory()) {
          linkedDirs.push(rel);
          continue;
        }
        target = real;
      } else if (!entry.isFile()) continue;
      const s = await stat(target);
      if (!s.isFile()) continue;
      if (s.size > limits.maxFileBytes) throw new Error(`${rel}: ${s.size} bytes is over the ${mb(limits.maxFileBytes)} limit`);
      files.push({ rel, bytes: s.size });
    }
  }
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return { root: realRoot, files, outside, linkedDirs };
}

// Reads one file inside root. The path is checked with insidePath, and the real path (after any link) must stay inside root.
export async function readInside(root, rel, limits = LIMITS) {
  const clean = insidePath(rel);
  const realRoot = await realpath(root);
  // The real path is checked, not only the last part: a linked folder on the way could lead outside too.
  const real = await realpath(join(root, clean));
  if (!within(realRoot, real)) throw new Error(`${clean}: a link that points outside --dir; not read`);
  const s = await stat(real);
  if (!s.isFile()) throw new Error(`${clean}: not a file`);
  if (s.size > limits.maxFileBytes) throw new Error(`${clean}: ${s.size} bytes is over the ${mb(limits.maxFileBytes)} limit`);
  return readFile(real);
}

// Reads a file named on the command line (a manifest, a budget file, a baseline) as UTF-8 text within the size limit.
export async function readBounded(path, limits = LIMITS) {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`${path}: not a file`);
  if (info.size > limits.maxFileBytes) throw new Error(`${path}: ${info.size} bytes is over the ${mb(limits.maxFileBytes)} limit`);
  return (await readFile(path, 'utf8')).replace(/^\uFEFF/, '');
}

// Parses JSON from a file read with readBounded, naming the file in the error.
export function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label}: not valid JSON (${error.message})`);
  }
}

// --glob: every JavaScript and CSS file of the folder is a page of its own, measured alone.
export function globBuild(files) {
  const entries = [];
  for (const f of files) {
    const kind = fileKind(f.rel);
    if (!kind) continue;
    entries.push({ name: f.rel, kind: 'file', js: kind === 'js' ? [f.rel] : [], css: kind === 'css' ? [f.rel] : [] });
  }
  const notes = entries.length ? [] : ['the folder holds no JavaScript or CSS file'];
  return { mode: 'glob', entries, lazy: [], referenced: [], notes };
}
