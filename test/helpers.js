// Shared test helpers: a temporary build folder made from inline files, removed after the test.

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export async function withBuild(files, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'bundle-budget-check-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, rel)), { recursive: true });
      await writeFile(join(dir, rel), typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content));
    }
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Text that compresses like source code: words in a fixed pseudo-random order.
export function filler(bytes, seed = 1) {
  const words = ['const', 'value', 'render', 'props', 'state', 'return', 'function', 'item', 'index', 'list', 'event', 'theme'];
  let s = seed;
  let out = '';
  while (out.length < bytes) {
    s = (s * 1103515245 + 12345) % 2147483648;
    out += `${words[s % words.length]}${s % 97} `;
  }
  return out.slice(0, bytes);
}
