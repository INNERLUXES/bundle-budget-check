import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIMITS, fileKind, insidePath, walkBuild, readInside, readBounded, parseJson, globBuild } from '../src/index.js';
import { withBuild } from './helpers.js';

// Creates a link, or returns false where the platform does not allow it (Windows without the right to create links).
async function tryLink(target, path, type) {
  try {
    await symlink(target, path, type);
    return true;
  } catch {
    return false;
  }
}

test('insidePath keeps paths inside --dir and refuses the rest', () => {
  assert.equal(insidePath('assets/index.js'), 'assets/index.js');
  assert.equal(insidePath('./assets//index.js'), 'assets/index.js');
  assert.equal(insidePath('assets\\index.js'), 'assets/index.js');
  assert.throws(() => insidePath('../secret.js'), /escapes --dir/);
  assert.throws(() => insidePath('assets/../../secret.js'), /escapes --dir/);
  assert.throws(() => insidePath('..\\secret.js'), /escapes --dir/);
  assert.throws(() => insidePath('/etc/passwd'), /absolute/);
  assert.throws(() => insidePath('\\\\server\\share\\a.js'), /absolute/);
  assert.throws(() => insidePath('C:\\Windows\\a.js'), /absolute/);
  assert.throws(() => insidePath('file:///etc/passwd'), /absolute/);
  assert.throws(() => insidePath('a\u0000.js'), /NUL/);
  assert.throws(() => insidePath(''), /empty/);
  assert.throws(() => insidePath(42), /empty or non-text/);
  assert.throws(() => insidePath('./.'), /names no file/);
});

test('fileKind tells JavaScript from CSS by the file name', () => {
  assert.equal(fileKind('a.js'), 'js');
  assert.equal(fileKind('a.MJS'), 'js');
  assert.equal(fileKind('a.cjs'), 'js');
  assert.equal(fileKind('a.css'), 'css');
  assert.equal(fileKind('a.js.map'), null);
  assert.equal(fileKind('logo.svg'), null);
});

test('walkBuild lists every file under the folder, sorted, with forward slashes', async () => {
  await withBuild({ 'index.html': '<html></html>', 'assets/b.js': 'b', 'assets/a.css': 'a', 'assets/deep/c.js': 'cc', 'static/x.js': 'x' }, async (dir) => {
    const w = await walkBuild(dir);
    assert.deepEqual(w.files.map((f) => f.rel), ['assets/a.css', 'assets/b.js', 'assets/deep/c.js', 'index.html', 'static/x.js']);
    assert.equal(w.files.find((f) => f.rel === 'assets/deep/c.js').bytes, 2);
    const s = await walkBuild(dir, 'static');
    assert.deepEqual(s.files.map((f) => f.rel), ['static/x.js']);
    assert.deepEqual((await walkBuild(dir, 'nothing-here')).files, []);
    await assert.rejects(walkBuild(join(dir, 'index.html')), /not a folder/);
  });
});

test('walkBuild refuses a file over the size limit and more files than the limit', async () => {
  await withBuild({ 'a.js': 'x'.repeat(2500), 'b.js': 'b', 'c.js': 'c' }, async (dir) => {
    await assert.rejects(walkBuild(dir, '', { maxFileBytes: 1000, maxFiles: 10 }), /a\.js: 2500 bytes is over the/);
    await assert.rejects(walkBuild(dir, '', { maxFileBytes: 10_000, maxFiles: 2 }), /more than 2 files/);
    assert.equal((await walkBuild(dir, '', { maxFileBytes: 10_000, maxFiles: 3 })).files.length, 3);
  });
  assert.equal(LIMITS.maxFileBytes, 50 * 1024 * 1024);
  assert.equal(LIMITS.maxFiles, 20_000);
});

test('symlinks: a link to a file outside --dir is never followed; a link inside is read', async (t) => {
  const outside = await mkdtemp(join(tmpdir(), 'bundle-budget-check-outside-'));
  try {
    await writeFile(join(outside, 'secret.js'), 'the secret');
    await withBuild({ 'assets/real.js': 'real content' }, async (dir) => {
      if (!(await tryLink(join(outside, 'secret.js'), join(dir, 'assets/leak.js'), 'file'))) {
        t.skip('this platform does not allow creating symlinks here');
        return;
      }
      await tryLink(join(dir, 'assets/real.js'), join(dir, 'assets/alias.js'), 'file');
      const w = await walkBuild(dir);
      assert.deepEqual(w.files.map((f) => f.rel), ['assets/alias.js', 'assets/real.js']);
      assert.deepEqual(w.outside, ['assets/leak.js']);
      await assert.rejects(readInside(dir, 'assets/leak.js'), /points outside --dir/);
      assert.equal((await readInside(dir, 'assets/alias.js')).toString(), 'real content');
    });
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test('symlinks: links to folders are not followed, so a loop of links cannot run and nothing outside is read', async (t) => {
  const outside = await mkdtemp(join(tmpdir(), 'bundle-budget-check-outside-'));
  try {
    await writeFile(join(outside, 'secret.js'), 'the secret');
    await withBuild({ 'assets/a.js': 'a' }, async (dir) => {
      if (!(await tryLink(dir, join(dir, 'assets/loop'), 'junction'))) {
        t.skip('this platform does not allow creating folder links here');
        return;
      }
      await tryLink(outside, join(dir, 'elsewhere'), 'junction');
      const w = await walkBuild(dir);
      assert.deepEqual(w.files.map((f) => f.rel), ['assets/a.js']);
      assert.deepEqual(w.linkedDirs, ['assets/loop']);
      assert.deepEqual(w.outside, ['elsewhere']);
      await assert.rejects(readInside(dir, 'elsewhere/secret.js'), /points outside --dir/);
    });
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test('readInside reads files inside the folder only, within the size limit', async () => {
  await withBuild({ 'assets/a.js': 'abc', 'big.js': 'x'.repeat(100) }, async (dir) => {
    assert.equal((await readInside(dir, 'assets/a.js')).toString(), 'abc');
    await assert.rejects(readInside(dir, '../a.js'), /escapes --dir/);
    await assert.rejects(readInside(dir, 'assets'), /not a file/);
    await assert.rejects(readInside(dir, 'big.js', { maxFileBytes: 10, maxFiles: 10 }), /over the/);
    await assert.rejects(readInside(dir, 'none.js'), { code: 'ENOENT' });
  });
});

test('readBounded strips a byte order mark and parseJson names the file in errors', async () => {
  await withBuild({ 'b.json': '\uFEFF{"a":1}', 'bad.json': '{a:' }, async (dir) => {
    assert.deepEqual(parseJson(await readBounded(join(dir, 'b.json')), 'b.json'), { a: 1 });
    assert.throws(() => parseJson('{a:', 'bad.json'), /bad\.json: not valid JSON/);
    await assert.rejects(readBounded(dir), /not a file/);
  });
});

test('globBuild: each JavaScript and CSS file is a page of its own', () => {
  const g = globBuild([{ rel: 'a.js', bytes: 1 }, { rel: 'b.css', bytes: 1 }, { rel: 'a.js.map', bytes: 1 }, { rel: 'index.html', bytes: 1 }]);
  assert.equal(g.mode, 'glob');
  assert.deepEqual(g.entries, [{ name: 'a.js', kind: 'file', js: ['a.js'], css: [] }, { name: 'b.css', kind: 'file', js: [], css: ['b.css'] }]);
  assert.deepEqual(globBuild([]).notes, ['the folder holds no JavaScript or CSS file']);
});
