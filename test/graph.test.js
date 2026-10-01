import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staticClosure, closureFiles, dynamicReach } from '../src/index.js';

const chunks = {
  'index.html': { file: 'assets/index.js', imports: ['_vendor.js', '_ui.js'], dynamicImports: ['src/Report.tsx'], css: ['assets/index.css'] },
  'admin.html': { file: 'assets/admin.js', imports: ['_ui.js'], dynamicImports: [], css: [] },
  '_vendor.js': { file: 'assets/vendor.js', imports: [], css: [] },
  '_ui.js': { file: 'assets/ui.js', imports: ['_vendor.js'], css: ['assets/ui.css'] },
  'src/Report.tsx': { file: 'assets/Report.js', imports: ['_vendor.js', '_chart.js'], dynamicImports: ['src/Detail.tsx'], css: ['assets/ui.css'] },
  '_chart.js': { file: 'assets/chart.js', imports: [], css: [] },
  'src/Detail.tsx': { file: 'assets/Detail.js', imports: [], dynamicImports: ['src/Report.tsx'], css: [] }
};

test('staticClosure: an entry, its static imports and theirs, with a shared chunk counted once', () => {
  const c = staticClosure(chunks, 'index.html');
  assert.deepEqual(c.chunks, ['index.html', '_vendor.js', '_ui.js']);
  assert.deepEqual(c.unknown, []);
  assert.deepEqual(staticClosure(chunks, 'admin.html').chunks, ['admin.html', '_ui.js', '_vendor.js']);
});

test('staticClosure ends on an import cycle and lists imports with no manifest entry', () => {
  const cyclic = {
    a: { file: 'a.js', imports: ['b'] },
    b: { file: 'b.js', imports: ['c'] },
    c: { file: 'c.js', imports: ['a', 'missing'] }
  };
  const c = staticClosure(cyclic, 'a');
  assert.deepEqual(c.chunks, ['a', 'b', 'c']);
  assert.deepEqual(c.unknown, ['missing']);
  assert.deepEqual(staticClosure({ self: { file: 's.js', imports: ['self'] } }, 'self').chunks, ['self']);
});

test('closureFiles lists each JavaScript and CSS file once', () => {
  const f = closureFiles(chunks, ['index.html', '_vendor.js', '_ui.js', 'src/Report.tsx']);
  assert.deepEqual(f.js, ['assets/index.js', 'assets/vendor.js', 'assets/ui.js', 'assets/Report.js']);
  assert.deepEqual(f.css, ['assets/index.css', 'assets/ui.css']);
  assert.deepEqual(closureFiles({ s: { file: 'style.css', css: [] } }, ['s']), { js: [], css: ['style.css'] });
});

test('dynamicReach follows dynamic imports through lazy chunks, each once, through cycles', () => {
  assert.deepEqual(dynamicReach(chunks, 'index.html'), ['src/Report.tsx', 'src/Detail.tsx']);
  assert.deepEqual(dynamicReach(chunks, 'admin.html'), []);
  assert.deepEqual(dynamicReach({ a: { file: 'a.js', dynamicImports: ['a', 'gone'] } }, 'a'), []);
});
