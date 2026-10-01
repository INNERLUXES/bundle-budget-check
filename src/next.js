// Reads the client manifests of a Next.js build (the .next folder after next build) and works out what each route loads.
//   build-manifest.json      "pages": { "/route": [files] } for the pages router; every page also loads the files of "/_app"
//   app-build-manifest.json  "pages": { "/route/page": [files], "/route/layout": [files] } for the app router, when present
// Only files under static/ are counted: they are the ones the browser downloads. The format is not a public interface of
// Next.js and changes between versions; docs/limits.md says what is read and what is not.

import { join } from 'node:path';
import { insidePath, readBounded, parseJson } from './files.js';

export const NEXT_MANIFESTS = { pages: 'build-manifest.json', app: 'app-build-manifest.json' };

function fileList(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((x) => typeof x !== 'string')) throw new Error(`${label} is not a list of files`);
  return value.map(insidePath);
}

function unique(list) {
  return [...new Set(list)];
}

// Routes of the two manifests. pagesManifest is the parsed build-manifest.json; appManifest the parsed
// app-build-manifest.json or null. Returns { mode, entries, lazy, referenced, notes } like viteBuild.
export function nextBuild(pagesManifest, appManifest = null) {
  if (!pagesManifest || typeof pagesManifest !== 'object' || !pagesManifest.pages || typeof pagesManifest.pages !== 'object') {
    throw new Error(`${NEXT_MANIFESTS.pages}: not a Next.js build manifest (no "pages")`);
  }
  const notes = [];
  let skipped = 0;
  const staticOnly = (files) => files.filter((f) => {
    if (f.startsWith('static/')) return true;
    skipped += 1;
    return false;
  });
  const entries = [];
  const pages = pagesManifest.pages;
  const appFiles = fileList(pages['/_app'], `${NEXT_MANIFESTS.pages} "/_app"`);
  for (const route of Object.keys(pages).sort()) {
    if (route.startsWith('/_')) continue;
    const files = staticOnly(unique([...appFiles, ...fileList(pages[route], `${NEXT_MANIFESTS.pages} "${route.slice(0, 200)}"`)]));
    entries.push({ name: route, kind: 'pages', js: files.filter((f) => /\.m?js$/i.test(f)), css: files.filter((f) => /\.css$/i.test(f)) });
  }
  if (appManifest) {
    if (typeof appManifest !== 'object' || !appManifest.pages || typeof appManifest.pages !== 'object') {
      throw new Error(`${NEXT_MANIFESTS.app}: not a Next.js app build manifest (no "pages")`);
    }
    const app = appManifest.pages;
    const root = fileList(pagesManifest.rootMainFiles, `${NEXT_MANIFESTS.pages} "rootMainFiles"`);
    const routes = Object.keys(app).filter((k) => /(?:^|\/)page$/.test(k)).map((k) => [k.replace(/\/?page$/, '') || '/', k]);
    routes.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [route, key] of routes) {
      if (/^\/_/.test(route)) continue;
      // A page loads the layouts of every folder above it, from the root layout down.
      const parts = route === '/' ? [] : route.split('/').slice(1);
      const layouts = ['/layout'];
      for (let i = 1; i <= parts.length; i += 1) layouts.push(`/${parts.slice(0, i).join('/')}/layout`);
      const all = [...root];
      for (const l of layouts) if (Object.hasOwn(app, l)) all.push(...fileList(app[l], `${NEXT_MANIFESTS.app} "${l.slice(0, 200)}"`));
      all.push(...fileList(app[key], `${NEXT_MANIFESTS.app} "${key.slice(0, 200)}"`));
      const files = staticOnly(unique(all));
      entries.push({ name: route, kind: 'app', js: files.filter((f) => /\.m?js$/i.test(f)), css: files.filter((f) => /\.css$/i.test(f)) });
    }
  }
  if (skipped) notes.push(`${skipped} file name(s) in the Next.js manifests are not under static/ and were not counted`);
  if (!entries.length) notes.push('the Next.js manifests list no route');
  const referenced = unique(entries.flatMap((e) => [...e.js, ...e.css]));
  return { mode: 'next', entries, lazy: [], referenced, notes };
}

// Reads build-manifest.json and, when present, app-build-manifest.json from a .next folder.
export async function readNextBuild(nextDir) {
  const pagesPath = join(nextDir, NEXT_MANIFESTS.pages);
  let pagesText;
  try {
    pagesText = await readBounded(pagesPath);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${pagesPath}: no such file; give the .next folder after next build`);
    throw error;
  }
  let appManifest = null;
  const appPath = join(nextDir, NEXT_MANIFESTS.app);
  try {
    appManifest = parseJson(await readBounded(appPath), appPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return nextBuild(parseJson(pagesText, pagesPath), appManifest);
}
