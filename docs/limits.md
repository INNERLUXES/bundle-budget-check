# Limits

## What a size check cannot see

- **Size is not speed.** The tool counts bytes. It does not measure how long a page takes to load or to respond. Two bundles of the same size can cost very different amounts of time: one may run a little setup code, the other may render a large tree, build big data structures or block the main thread on start-up. Parse and compile time grows with the raw size, but execution time depends on what the code does. Measure the pages that matter in a browser as well, in the lab with a throttled device and in the field with real-user data, and treat the budget as a guard against drift, not as a score.
- **The network.** The same bytes take very different times on fibre and on a weak mobile connection. Latency, the number of requests, HTTP/2 or HTTP/3 multiplexing, `modulepreload` hints and the order in which the browser discovers files all change how long a page waits. The tool adds up sizes; it does not model any of that.
- **The cache.** The up-front size is what a first visit downloads. A returning visitor may have the vendor chunk cached and download only what changed. Conversely, a chunking change that moves code between files can make every visitor download everything again even when the total did not grow. The tool does not see cache hit rates or file name stability.
- **Scripts added at run time.** Tag managers, analytics, chat widgets, A/B testing tools, consent banners, ads and other third-party scripts are usually injected by a snippet or loaded from another host after the page starts. They are not in the build output or the manifest, so they are not counted, and they are often larger than the app itself. Count them with a browser-based tool and give them a budget of their own.
- **Server rendering.** With server-side rendering or static generation, the HTML arrives before the JavaScript, so the first paint may not wait for the bundle at all, while interaction still does. With React Server Components, part of the work never ships to the browser. The size of the client bundle is still the right thing to budget, but its effect on Largest Contentful Paint differs from that of a client-rendered app, and the HTML and the inline data payload are not counted.
- **Compression on the real server.** The tool compresses each file with gzip level 9 and brotli quality 11. A server that compresses on the fly often uses lower levels, and some do not compress at all, so the bytes on the wire can be larger. Choose the compression that matches what your server or CDN sends, or `raw` to stay on the safe side.
- **Compressor versions.** Compressed sizes come from the zlib and brotli code built into Node. Different Node versions, and in rare cases different processors, can produce outputs that differ by a few bytes. Raw sizes never differ. Keep a few percent of margin under each budget, and build the `--baseline` with the same Node version as the check.
- **Images, fonts and other assets.** Only JavaScript and CSS are measured. Images, fonts, video, JSON data files and WebAssembly loaded by a page are not counted, even when the manifest lists them under `assets`.
- **What runs, not what is imported.** The closure counts every file a page imports statically, even when the code in it is used only on rare paths. It does not tell you which parts of a file are used (code coverage in the browser's developer tools does) or which dependency made a chunk large (a bundle visualiser does). The tool says that a page is too large and which files are largest; finding the cause is the next step.

## Next.js manifests vary by version

`build-manifest.json` and `app-build-manifest.json` are files Next.js writes for its own use. They are not documented as a public interface, and their shape has changed between major versions and between the webpack and Turbopack builds. The tool reads what has been stable for a long time: the `pages` object of each file, mapping a route or a `page` or `layout` entry to a list of files, plus `rootMainFiles` for the app router. If a version writes these differently, the tool may report fewer files than the browser loads, or stop with an error about the format. In particular:

- Files loaded by the app router through other means, such as client reference manifests, inline scripts, or chunks discovered at run time, are not seen.
- `polyfillFiles` are not counted, since only browsers without module support load them.
- Files outside `static/` (server code) are never counted; a note says how many names were left out.
- Layouts are matched by folder, from the root down to the page. Parallel routes, intercepting routes and route groups are read as folder names, which may not match how Next.js combines them.

Compare the page table with the "First Load JS" column that `next build` prints for the same build. When they differ a lot, check the manifests of your version before trusting the budget.

## What is read

- **Vite manifests**: an object of chunks, each with `file`, and optionally `imports`, `dynamicImports`, `css`, `assets`, `isEntry` and `isDynamicEntry`. Unknown fields are ignored. Imports of chunk names the manifest does not define are listed in a note and skipped.
- **Next.js manifests**: `build-manifest.json` (required) and `app-build-manifest.json` (optional), from the folder given with `--next`.
- **The build output folder**: every file under `--dir` (or under `static/` of the `--next` folder) is listed. `.js`, `.mjs`, `.cjs` and `.css` files are measured; `.map` files are counted for `source-map-shipped`; other files are ignored.
- **The budget file and the baseline**: JSON, read whole. A byte order mark is accepted.

## Size

- A file over 50 MB in the build output stops the run, and so does a manifest, a budget file or a baseline over 50 MB.
- At most 20,000 files are listed in the build output folder. A larger folder stops the run with exit code 2, rather than measuring part of the build: a page over budget in the part left out would be missed. Point `--dir` at the folder that is deployed, not at the project.
- A Vite manifest with more than 20,000 entries stops the run.
- Text shown in a report is cut to a fixed length: 300 characters for a name or a path, 1,200 for a message.

Every limit is reported, as an error or a note, so a cut is never silent.
