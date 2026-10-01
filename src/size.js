// Sizes: reading "170 KB" from a budget file, writing sizes for a report, and measuring a file raw, gzip and brotli.
// KB and MB are decimal (1 KB = 1000 bytes), as browser developer tools and most build tools print them;
// KiB and MiB are binary (1 KiB = 1024 bytes).

import { createHash } from 'node:crypto';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { readInside, LIMITS } from './files.js';

export const UNITS = { b: 1, kb: 1000, mb: 1000 * 1000, kib: 1024, mib: 1024 * 1024 };
export const COMPRESSIONS = ['gzip', 'brotli', 'raw'];

// A size in bytes from a number of bytes or a string such as "170 KB", "1.5MB", "64 KiB" or "900 B".
export function parseSize(value, label = 'size') {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label}: ${value} is not a size; give a number of bytes of at least 0`);
    return Math.round(value);
  }
  if (typeof value !== 'string') throw new Error(`${label}: give a number of bytes or a text such as "170 KB"`);
  const m = /^\s*(\d{1,12}(?:\.\d{1,6})?)\s*([A-Za-z]{0,3})\s*$/.exec(value);
  const unit = m ? (m[2] || 'b').toLowerCase() : null;
  if (!m || !Object.hasOwn(UNITS, unit)) {
    throw new Error(`${label}: "${String(value).slice(0, 40)}" is not a size; write it like 170 KB, 1.5 MB, 64 KiB or 900 B`);
  }
  return Math.round(Number(m[1]) * UNITS[unit]);
}

// A size for a report, in decimal units: 900 B, 52.1 KB, 1.25 MB.
export function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return '-';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs < 1000) return `${sign}${abs} B`;
  const [value, unit] = abs < 1000 * 1000 ? [abs / 1000, 'KB'] : [abs / 1000 / 1000, 'MB'];
  return `${sign}${value.toFixed(2).replace(/\.?0+$/, '')} ${unit}`;
}

// Raw, gzip (level 9) and brotli (quality 11) sizes of a buffer, and a SHA-256 hash of its content.
export function measureBuffer(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return {
    raw: buf.length,
    gzip: gzipSync(buf, { level: 9 }).length,
    brotli: brotliCompressSync(buf, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: buf.length
      }
    }).length,
    hash: createHash('sha256').update(buf).digest('hex')
  };
}

// Measures files inside root, each once: a file named by two pages is read and compressed one time.
export function createMeasurer(root, limits = LIMITS) {
  const cache = new Map();
  return {
    async measure(rel) {
      if (!cache.has(rel)) cache.set(rel, measureBuffer(await readInside(root, rel, limits)));
      return cache.get(rel);
    },
    get(rel) {
      return cache.get(rel);
    },
    get size() {
      return cache.size;
    }
  };
}
