// The import graph of a build: which chunks a page loads up front and which it can load later.
// Chunks are the entries of a Vite manifest: { file, imports, dynamicImports, css }, keyed by their manifest key.

// The static import closure of start: start and every chunk it imports, directly or through other chunks.
// Each chunk is visited once, so a chunk shared by two imports is counted once and an import cycle ends.
// Returns { chunks: [key], unknown: [key] } in the order they were first reached; unknown lists imports with no manifest entry.
export function staticClosure(chunks, start) {
  const order = [];
  const unknown = [];
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const key = stack.pop();
    if (seen.has(key)) continue;
    seen.add(key);
    const chunk = Object.hasOwn(chunks, key) ? chunks[key] : null;
    if (!chunk) {
      unknown.push(key);
      continue;
    }
    order.push(key);
    const imports = chunk.imports || [];
    for (let i = imports.length - 1; i >= 0; i -= 1) if (!seen.has(imports[i])) stack.push(imports[i]);
  }
  return { chunks: order, unknown };
}

// The files a closure loads: the JavaScript file of each chunk and the CSS of each chunk, each file once.
export function closureFiles(chunks, keys) {
  const js = [];
  const css = [];
  const seenJs = new Set();
  const seenCss = new Set();
  for (const key of keys) {
    const chunk = chunks[key];
    if (chunk.file && !seenJs.has(chunk.file)) {
      seenJs.add(chunk.file);
      (/\.css$/i.test(chunk.file) ? css : js).push(chunk.file);
    }
    for (const file of chunk.css || []) {
      if (!seenCss.has(file)) {
        seenCss.add(file);
        css.push(file);
      }
    }
  }
  return { js, css };
}

// The chunks a page can load later: every dynamic import reachable from its closure, and the dynamic imports
// of those, and so on. Returns the keys in the order first reached; each key once, so cycles end.
export function dynamicReach(chunks, start) {
  const found = [];
  const seen = new Set();
  const queue = [start];
  const visited = new Set();
  while (queue.length) {
    const from = queue.shift();
    if (visited.has(from)) continue;
    visited.add(from);
    for (const key of staticClosure(chunks, from).chunks) {
      for (const dyn of chunks[key].dynamicImports || []) {
        if (dyn !== start && !seen.has(dyn) && Object.hasOwn(chunks, dyn)) {
          seen.add(dyn);
          found.push(dyn);
          queue.push(dyn);
        }
      }
    }
  }
  return found;
}
