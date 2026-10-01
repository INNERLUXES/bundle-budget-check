import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { UNITS, COMPRESSIONS, parseSize, formatSize, measureBuffer, createMeasurer } from '../src/index.js';
import { withBuild, filler } from './helpers.js';

test('parseSize: KB and MB are decimal, KiB and MiB are binary', () => {
  assert.equal(parseSize('170 KB'), 170_000);
  assert.equal(parseSize('170KB'), 170_000);
  assert.equal(parseSize('170 kb'), 170_000);
  assert.equal(parseSize('64 KiB'), 65_536);
  assert.equal(parseSize('1.5 MB'), 1_500_000);
  assert.equal(parseSize('1 MiB'), 1_048_576);
  assert.equal(parseSize('900 B'), 900);
  assert.equal(parseSize('900'), 900);
  assert.equal(parseSize(12_345), 12_345);
  assert.equal(parseSize(0), 0);
  assert.deepEqual(Object.keys(UNITS), ['b', 'kb', 'mb', 'kib', 'mib']);
});

test('parseSize refuses what is not a size', () => {
  for (const bad of ['', 'big', '10 GB', '-5 KB', '1e3', '10 K B', 'KB', '1.2.3 KB']) assert.throws(() => parseSize(bad), /not a size/, bad);
  assert.throws(() => parseSize(-1), /at least 0/);
  assert.throws(() => parseSize(Number.NaN), /not a size/);
  assert.throws(() => parseSize(null, 'default.js'), /default\.js/);
  assert.throws(() => parseSize({}), /number of bytes/);
});

test('formatSize writes decimal units with at most two decimals', () => {
  assert.equal(formatSize(0), '0 B');
  assert.equal(formatSize(999), '999 B');
  assert.equal(formatSize(1000), '1 KB');
  assert.equal(formatSize(52_100), '52.1 KB');
  assert.equal(formatSize(36_071), '36.07 KB');
  assert.equal(formatSize(1_250_000), '1.25 MB');
  assert.equal(formatSize(-510), '-510 B');
  assert.equal(formatSize(Number.NaN), '-');
});

test('measureBuffer gives the raw, gzip level 9 and brotli quality 11 sizes', () => {
  const text = filler(20_000);
  const m = measureBuffer(Buffer.from(text));
  assert.equal(m.raw, 20_000);
  assert.equal(m.gzip, gzipSync(Buffer.from(text), { level: 9 }).length);
  assert.equal(m.brotli, brotliCompressSync(Buffer.from(text), { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: 20_000 } }).length);
  assert.ok(m.gzip < m.raw && m.brotli < m.raw);
  assert.match(m.hash, /^[0-9a-f]{64}$/);
  assert.equal(measureBuffer(text).hash, m.hash);
  assert.notEqual(measureBuffer('other').hash, m.hash);
  const repeated = measureBuffer(Buffer.alloc(100_000, 97));
  assert.ok(repeated.gzip < 1000, 'a run of one byte compresses to almost nothing');
  assert.deepEqual(COMPRESSIONS, ['gzip', 'brotli', 'raw']);
});

test('createMeasurer reads and compresses each file once', async () => {
  await withBuild({ 'a.js': filler(5000), 'b.css': filler(3000, 2) }, async (dir) => {
    const m = createMeasurer(dir);
    const first = await m.measure('a.js');
    await writeFile(join(dir, 'a.js'), 'changed');
    const again = await m.measure('a.js');
    assert.equal(again, first, 'the cached result is returned');
    assert.equal(again.raw, 5000);
    await m.measure('b.css');
    assert.equal(m.size, 2);
    assert.equal(m.get('b.css').raw, 3000);
    await assert.rejects(m.measure('../outside.js'), /escapes --dir/);
  });
});
