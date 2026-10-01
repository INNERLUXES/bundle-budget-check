// Reads a Vite build manifest (build.manifest: true) and works out what each page loads.
// The manifest format is described in the Vite guide, "Backend Integration": https://vite.dev/guide/backend-integration.html
// Each entry is keyed by its source path (or "_name.js" for a shared chunk) and holds
// { file, imports, dynamicImports, css, isEntry, isDynamicEntry }.

import { stat } from 'node:fs/promises';
import { insidePath } from './files.js';
import { staticClosure, closureFiles, dynamicReach } from './graph.js';

export const VITE_MANIFEST_PATHS = ['.vite/manifest.json', 'manifest.json'];
export const MAX_MANIFEST_ENTRIES = 20_000;

const LISTS = ['imports', 'dynamicImports', 'css', 'assets'];

// The default manifest inside dir: .vite/manifest.json (Vite 5 and later), then manifest.json (earlier versions).
export async function findViteManifest(dir) {
  for (const p of VITE_MANIFEST_PATHS) {
    const path = `${dir.replace(/[\\/]+$/, '')}/${p}`;
    try {
      if ((await stat(path)).isFile()) return path;
    } catch {
      // try the next place
    }
  }
  return null;
}

// Checks the shape of a manifest and the paths in it. Paths that leave --dir stop the run.
export function parseViteManifest(data, label = 'manifest') {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${label}: not a Vite manifest (expected an object of chunks)`);
  const keys = Object.keys(data);
  if (keys.length > MAX_MANIFEST_ENTRIES) throw new Error(`${label}: more than ${MAX_MANIFEST_ENTRIES.toLocaleString('en-US')} entries, which is over the limit`);
  const chunks = Object.create(null);
  for (const key of keys) {
    const c = data[key];
    if (!c || typeof c !== 'object' || typeof c.file !== 'string') throw new Error(`${label}: entry "${key.slice(0, 200)}" has no "file"`);
    const chunk = { file: insidePath(c.file), isEntry: c.isEntry === true, isDynamicEntry: c.isDynamicEntry === true };
    for (const list of LISTS) {
      const v = c[list] ?? [];
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new Error(`${label}: "${list}" of entry "${key.slice(0, 200)}" is not a list of names`);
      chunk[list] = list === 'css' || list === 'assets' ? v.map(insidePath) : [...v];
    }
    chunks[key] = chunk;
  }
  return chunks;
}

// The pages and lazy chunks of a Vite build.
//   entries: one per isEntry chunk, with the JavaScript and CSS it loads up front (the entry, its static imports, their CSS)
//   lazy:    one per chunk reached only through a dynamic import, with the files it adds to what its pages already loaded
//   referenced: every JavaScript and CSS file the manifest names
export function viteBuild(chunks) {
  const entries = [];
  const unknown = new Set();
  const upFront = new Map();
  const parents = new Map();
  for (const key of Object.keys(chunks)) {
    if (!chunks[key].isEntry) continue;
    const closure = staticClosure(chunks, key);
    for (const u of closure.unknown) unknown.add(u);
    const files = closureFiles(chunks, closure.chunks);
    entries.push({ name: key, kind: 'entry', js: files.js, css: files.css, chunks: closure.chunks.length });
    upFront.set(key, new Set([...files.js, ...files.css]));
    for (const dyn of dynamicReach(chunks, key)) {
      if (!parents.has(dyn)) parents.set(dyn, []);
      parents.get(dyn).push(key);
    }
  }
  const lazy = [];
  for (const key of Object.keys(chunks)) {
    const c = chunks[key];
    if (c.isEntry || (!c.isDynamicEntry && !parents.has(key))) continue;
    const closure = staticClosure(chunks, key);
    for (const u of closure.unknown) unknown.add(u);
    const from = parents.get(key) || [];
    // Files every page that can load this chunk has already loaded are not counted again.
    let loaded = null;
    for (const p of from) {
      const s = upFront.get(p);
      loaded = loaded === null ? new Set(s) : new Set([...loaded].filter((f) => s.has(f)));
    }
    loaded = loaded || new Set();
    const files = closureFiles(chunks, closure.chunks);
    lazy.push({ name: key, kind: 'lazy', js: files.js.filter((f) => !loaded.has(f)), css: files.css.filter((f) => !loaded.has(f)), from });
  }
  const referenced = new Set();
  for (const c of Object.values(chunks)) {
    referenced.add(c.file);
    for (const f of c.css) referenced.add(f);
  }
  const notes = [];
  if (unknown.size) notes.push(`the manifest imports ${unknown.size} chunk name(s) it does not define: ${[...unknown].slice(0, 5).join(', ')}`);
  if (!entries.length) notes.push('the manifest has no entry with "isEntry": true');
  return { mode: 'vite', entries, lazy, referenced: [...referenced].filter((f) => /\.(?:m?js|cjs|css)$/i.test(f)), notes };
}
