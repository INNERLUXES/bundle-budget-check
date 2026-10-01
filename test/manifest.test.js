import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  VITE_MANIFEST_PATHS, MAX_MANIFEST_ENTRIES, findViteManifest, parseViteManifest, viteBuild,
  NEXT_MANIFESTS, nextBuild, readNextBuild
} from '../src/index.js';
import { withBuild } from './helpers.js';

const vite = {
  'index.html': { file: 'assets/index.js', isEntry: true, imports: ['_vendor.js', '_ui.js'], dynamicImports: ['src/Report.tsx', 'src/Help.tsx'], css: ['assets/index.css'] },
  'admin.html': { file: 'assets/admin.js', isEntry: true, imports: ['_vendor.js'], dynamicImports: ['src/Report.tsx'] },
  '_vendor.js': { file: 'assets/vendor.js' },
  '_ui.js': { file: 'assets/ui.js', imports: ['_vendor.js'], css: ['assets/ui.css'] },
  'src/Report.tsx': { file: 'assets/Report.js', isDynamicEntry: true, imports: ['_vendor.js', '_ui.js', '_chart.js'], css: ['assets/Report.css'] },
  'src/Help.tsx': { file: 'assets/Help.js', isDynamicEntry: true, imports: ['_ui.js'] },
  '_chart.js': { file: 'assets/chart.js', imports: ['_vendor.js'] },
  'logo.svg': { file: 'assets/logo.svg' }
};

test('Vite: each entry loads its file, its static imports recursively and their CSS, shared chunks once', () => {
  const b = viteBuild(parseViteManifest(vite));
  assert.equal(b.mode, 'vite');
  assert.deepEqual(b.entries.map((e) => e.name), ['index.html', 'admin.html']);
  const index = b.entries[0];
  assert.deepEqual(index.js, ['assets/index.js', 'assets/vendor.js', 'assets/ui.js']);
  assert.deepEqual(index.css, ['assets/index.css', 'assets/ui.css']);
  assert.equal(index.chunks, 3);
  assert.deepEqual(b.entries[1].js, ['assets/admin.js', 'assets/vendor.js']);
  assert.deepEqual(b.entries[1].css, []);
  assert.deepEqual(b.notes, []);
  assert.ok(!b.referenced.includes('assets/logo.svg'));
  assert.ok(b.referenced.includes('assets/Report.css'));
});

test('Vite: a lazy chunk counts only what the pages that load it have not loaded already', () => {
  const b = viteBuild(parseViteManifest(vite));
  const report = b.lazy.find((l) => l.name === 'src/Report.tsx');
  // Reached from index.html and admin.html: only vendor.js is loaded up front by both, so ui.js is counted.
  assert.deepEqual(report.from, ['index.html', 'admin.html']);
  assert.deepEqual(report.js, ['assets/Report.js', 'assets/ui.js', 'assets/chart.js']);
  assert.deepEqual(report.css, ['assets/Report.css', 'assets/ui.css']);
  const help = b.lazy.find((l) => l.name === 'src/Help.tsx');
  assert.deepEqual(help.js, ['assets/Help.js']);
  assert.deepEqual(help.css, []);
  assert.equal(b.lazy.length, 2);
});

test('Vite: an import cycle and an unknown import do not stop the run', () => {
  const b = viteBuild(parseViteManifest({
    'main.js': { file: 'a.js', isEntry: true, imports: ['_b.js'] },
    '_b.js': { file: 'b.js', imports: ['main.js', '_gone.js'] }
  }));
  assert.deepEqual(b.entries[0].js, ['a.js', 'b.js']);
  assert.match(b.notes[0], /1 chunk name\(s\) it does not define: _gone\.js/);
  assert.match(viteBuild(parseViteManifest({ '_x.js': { file: 'x.js' } })).notes[0], /no entry with "isEntry": true/);
});

test('Vite: a manifest path that escapes --dir stops the run', () => {
  assert.throws(() => parseViteManifest({ 'index.html': { file: '../../etc/app.js', isEntry: true } }), /escapes --dir/);
  assert.throws(() => parseViteManifest({ 'index.html': { file: 'a.js', css: ['/abs/style.css'] } }), /absolute/);
  assert.throws(() => parseViteManifest({ 'index.html': { file: 'a.js', assets: ['C:\\x.png'] } }), /absolute/);
  assert.throws(() => parseViteManifest([]), /not a Vite manifest/);
  assert.throws(() => parseViteManifest({ x: { name: 'no file' } }), /has no "file"/);
  assert.throws(() => parseViteManifest({ x: { file: 'a.js', imports: 'b' } }), /not a list of names/);
  assert.equal(MAX_MANIFEST_ENTRIES, 20_000);
});

test('Vite: the manifest is found in .vite/ first, then at the top of the folder', async () => {
  assert.deepEqual(VITE_MANIFEST_PATHS, ['.vite/manifest.json', 'manifest.json']);
  await withBuild({ '.vite/manifest.json': '{}', 'manifest.json': '{}' }, async (dir) => {
    assert.equal(await findViteManifest(dir), `${dir}/.vite/manifest.json`);
  });
  await withBuild({ 'manifest.json': '{}' }, async (dir) => {
    assert.equal(await findViteManifest(`${dir}/`), `${dir}/manifest.json`);
  });
  await withBuild({ 'index.html': '' }, async (dir) => {
    assert.equal(await findViteManifest(dir), null);
  });
});

const pagesManifest = {
  polyfillFiles: ['static/chunks/polyfills.js'],
  rootMainFiles: ['static/chunks/webpack.js', 'static/chunks/main-app.js'],
  pages: {
    '/': ['static/chunks/webpack.js', 'static/chunks/framework.js', 'static/chunks/main.js', 'static/chunks/pages/index.js'],
    '/blog/[slug]': ['static/chunks/webpack.js', 'static/chunks/framework.js', 'static/chunks/main.js', 'static/chunks/pages/blog/[slug].js', 'static/css/blog.css'],
    '/_app': ['static/chunks/webpack.js', 'static/chunks/framework.js', 'static/chunks/main.js', 'static/chunks/pages/_app.js', 'static/css/app.css'],
    '/_error': ['static/chunks/pages/_error.js']
  }
};

test('Next.js pages router: each route loads its files and those of /_app, each once; /_ routes are not pages', () => {
  const b = nextBuild(pagesManifest);
  assert.equal(b.mode, 'next');
  assert.deepEqual(b.entries.map((e) => [e.name, e.kind]), [['/', 'pages'], ['/blog/[slug]', 'pages']]);
  assert.deepEqual(b.entries[0].js, ['static/chunks/webpack.js', 'static/chunks/framework.js', 'static/chunks/main.js', 'static/chunks/pages/_app.js', 'static/chunks/pages/index.js']);
  assert.deepEqual(b.entries[0].css, ['static/css/app.css']);
  assert.deepEqual(b.entries[1].css, ['static/css/app.css', 'static/css/blog.css']);
  assert.ok(!b.referenced.includes('static/chunks/polyfills.js'), 'polyfills load only in old browsers');
  assert.deepEqual(b.lazy, []);
});

test('Next.js app router: a page loads the root files, every layout above it and its own files; only static/ counts', () => {
  const app = {
    pages: {
      '/layout': ['static/chunks/app/layout.js', 'static/css/root.css'],
      '/page': ['static/chunks/app/page.js'],
      '/dashboard/layout': ['static/chunks/app/dashboard/layout.js'],
      '/dashboard/settings/page': ['static/chunks/app/dashboard/settings/page.js', 'server/app/x.js'],
      '/_not-found/page': ['static/chunks/app/_not-found.js']
    }
  };
  const b = nextBuild(pagesManifest, app);
  const appRoutes = b.entries.filter((e) => e.kind === 'app');
  assert.deepEqual(appRoutes.map((e) => e.name), ['/', '/dashboard/settings']);
  assert.deepEqual(appRoutes[1].js, ['static/chunks/webpack.js', 'static/chunks/main-app.js', 'static/chunks/app/layout.js', 'static/chunks/app/dashboard/layout.js', 'static/chunks/app/dashboard/settings/page.js']);
  assert.deepEqual(appRoutes[1].css, ['static/css/root.css']);
  assert.match(b.notes[0], /1 file name\(s\) in the Next\.js manifests are not under static\//);
});

test('Next.js: manifests are read from the .next folder; app-build-manifest.json is optional; escapes are refused', async () => {
  assert.deepEqual(NEXT_MANIFESTS, { pages: 'build-manifest.json', app: 'app-build-manifest.json' });
  await withBuild({ 'build-manifest.json': pagesManifest }, async (dir) => {
    const b = await readNextBuild(dir);
    assert.equal(b.entries.length, 2);
  });
  await withBuild({ 'build-manifest.json': pagesManifest, 'app-build-manifest.json': { pages: { '/page': ['static/a.js'] } } }, async (dir) => {
    assert.equal((await readNextBuild(dir)).entries.length, 3);
  });
  await withBuild({ 'other.json': '{}' }, async (dir) => {
    await assert.rejects(readNextBuild(dir), /build-manifest\.json: no such file/);
  });
  await withBuild({ 'build-manifest.json': { pages: { '/': ['static/../../../secret.js'] } } }, async (dir) => {
    await assert.rejects(readNextBuild(join(dir)), /escapes --dir/);
  });
  assert.throws(() => nextBuild({ nopages: true }), /not a Next\.js build manifest/);
  assert.throws(() => nextBuild(pagesManifest, { routes: {} }), /not a Next\.js app build manifest/);
  assert.throws(() => nextBuild({ pages: { '/': 'static/a.js' } }), /not a list of files/);
});
