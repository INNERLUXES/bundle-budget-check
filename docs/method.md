# Method

The tool answers one question: how much JavaScript and CSS does each page of this build make the browser download before the page can run, and is that within the budget the team agreed on? It reads the build output folder and the manifest the bundler wrote next to it, works out which files each page loads, measures each file once, adds them up per page, and compares the sums with the budget file. The page metrics it protects are the ones described in [Web Vitals](https://web.dev/articles/vitals) on web.dev, and the Vite manifest format it reads is the one described in the Vite guide, [Backend Integration](https://vite.dev/guide/backend-integration.html).

## Why the size of a page's JavaScript is worth a gate

Core Web Vitals measure what a visitor feels: how soon the main content appears (Largest Contentful Paint), how soon the page answers a tap or a key press (Interaction to Next Paint), and how much the layout moves while it loads (Cumulative Layout Shift). In a React app rendered or hydrated in the browser, the JavaScript a page loads up front sits on the path of the first two. It has to be downloaded, then parsed and compiled, then run, and until it has run the page either shows nothing useful or shows markup that does not yet react to input. The browser's main thread does that work on the visitor's device, so a bundle that feels instant on a developer laptop can take seconds on a mid-range phone.

The size of the bundle is not the only thing that decides those metrics, but it is the one a build controls directly, the one that only ever grows unless someone watches it, and the one that can be measured exactly, on every pull request, without a browser or a device lab. A budget turns "the app is getting slower" into "this pull request adds 14 KB to the checkout page", which a reviewer can act on.

A finding is an **error** when a budget the team wrote down is broken: a page, a file, or growth over the limit, or a manifest that does not match the folder. It is a **warning** when something should be looked at but may be intended: a lazy chunk over its budget, growth under the limit, a source map about to be deployed. It is **info** when nothing is wrong but the fact is useful.

## Which files a page loads up front

The tool never runs the bundler. It reads what the bundler recorded.

**Vite.** With `build.manifest: true`, Vite writes `.vite/manifest.json` (earlier versions: `manifest.json`) into the output folder. Each entry is keyed by its source path, or by a name starting with `_` for a shared chunk, and records the output `file`, the chunks it `imports` statically, the chunks it loads with `dynamicImports`, its `css`, and whether it `isEntry` (a page or a script tag) or `isDynamicEntry` (the target of an `import()`). The Vite guide describes how a server renders a page from this manifest: a script tag for the entry, `modulepreload` links for its imports, and style links for the CSS of the entry and of every chunk it imports, recursively. The tool follows the same rule:

1. Start from an entry with `"isEntry": true`.
2. Add its file and its CSS.
3. For each chunk in `imports`, add that chunk's file and CSS, then follow its `imports` the same way.
4. A chunk already visited is not visited again. A shared chunk imported by three others is counted once for the page, and an import cycle (A imports B, B imports A) ends at the second visit.
5. `dynamicImports` are not followed for the up-front size. They are loaded only when the code runs `import()`, such as when the visitor opens a route or a dialog.

The sum of the sizes of those files is the page's up-front JS and CSS. A file used by two pages is measured once and counted in both pages, because each page, opened fresh, has to download it.

**Lazy chunks.** Every chunk with `"isDynamicEntry": true`, or reached from a page through `dynamicImports`, is a lazy chunk. It is measured as the files it adds: its own static import closure (by the same steps), minus the files that every page that can open it has already loaded up front. A route chunk that imports the vendor chunk does not count the vendor chunk again, because it is already in the browser when the route is opened. When several pages can open the same lazy chunk, only the files all of them have loaded are subtracted, so the number is what it adds in the worst case.

**Next.js.** After `next build`, the `.next` folder holds `build-manifest.json`, whose `pages` map each route of the pages router to the files the browser loads for it, and, for the app router, `app-build-manifest.json`, whose `pages` map each `page` and `layout` to its files. A pages-router route loads its own files and those of `/_app`. An app-router page loads the `rootMainFiles` of `build-manifest.json`, the files of the root layout and of every layout in the folders above it, and its own files. Only files under `static/` are counted: those are what the browser downloads. Routes whose name starts with `/_` (`/_app`, `/_document`, `/_error`, `/_not-found`) are not pages of their own. `polyfillFiles` are loaded only by browsers that do not support modules, and are not counted. The format of these files is not documented as a public interface and has changed between Next.js versions; docs/limits.md says what that means for the result.

**Without a manifest.** With `--glob`, every `.js`, `.mjs`, `.cjs` and `.css` file in the folder is measured alone and treated as a page of its own, with the file path as its name. Use it for a build tool that writes no manifest, or to put a ceiling on every file.

## Why compressed size

Servers and CDNs send JavaScript and CSS compressed, with gzip or brotli, so the bytes that cross the network are the compressed ones. The tool measures each file three ways: raw (the size on disk, which is roughly what the browser has to parse), gzip at level 9, and brotli at quality 11, the highest settings, as a build-time precompression step would use. Budgets are compared with one of them, chosen with `"compression"` in the budget file or `--compression`; gzip is the default because every server and CDN supports it. Use brotli when your CDN serves brotli, and raw when the cost you care about most is parse and compile time.

Each file is measured once, however many pages load it. The sizes are summed per page after compressing each file alone; a browser also receives each file as its own response, so this is the same unit the network sees.

Compressed sizes come from the zlib and brotli code inside Node. Two Node versions can produce outputs a few bytes apart for the same file; raw sizes never change. Leave a margin of a few percent between a page's size and its budget, and compare growth against a baseline made by the same Node version.

## Why budgets per page

One number for the whole build hides the page that matters. A dashboard that only signed-in staff open can carry a heavy charting library; the landing page that every visitor from search sees cannot. A budget per page, or per group of routes with a pattern, lets the team spend bytes where they buy something and keep the pages that decide first impressions lean. The `default` budget covers every page that has no budget of its own, so a new page is checked from its first build, and `no-budget` lists any page that nothing covers.

Patterns in `entries` are matched against the page name: the manifest key for Vite, the route for Next.js, the path for `--glob`. `*` matches any characters except `/`, and `**` matches any characters including `/`; nothing else is special. A pattern written exactly as the name wins, otherwise the first pattern that matches in the order the file lists them. A limit the pattern leaves out is taken from `default`, so a pattern can tighten only the JavaScript budget of a page and keep the default CSS and total budgets.

## The checks

| Id | Severity | Rule and why it matters |
| --- | --- | --- |
| `over-budget` | error | For each page and each of `js`, `css` and `total` that has a budget: the sum of the up-front files in the chosen compression is above the budget. The message gives the size, the budget, and how much over, in bytes and as a percentage of the budget. JS and CSS are checked apart because they cost differently: CSS blocks rendering, JavaScript blocks interaction |
| `file-over-budget` | error | A single JavaScript or CSS file in the folder is above `files.max`. A very large chunk is usually a dependency imported whole, or a chunking rule that put unrelated code together; it also defeats caching, since a change to any part of it makes every visitor download all of it again |
| `missing-file` | error | A file the manifest names is not in the folder, or is a link that points outside it. The manifest and the folder are from different builds, or files were removed after the build. The sizes of the pages that need it would be too low, so the run fails rather than pass on a partial count |
| `growth` | warning / error | With `--baseline`, a page whose total grew since the earlier report, in the same compression. The message gives the old and new size and the change. Any growth is a warning, so the reviewer sees it; growth above `--max-growth` (a percentage of the old size, or a size) is an error. Pages new since the baseline and pages that are gone are listed in notes |
| `lazy-over-budget` | warning | A lazy chunk adds more than `lazy.max` when it loads. Lazy chunks are loaded after the page is interactive, so they are not on the path of the first paint, but a large one still makes the route or dialog it serves slow to open |
| `source-map-shipped` | warning | `.map` files are in the folder that is deployed. A public source map publishes the original source, comments included, and they are usually larger than the code. Leave them out of the deploy, upload them to an error tracker instead, or pass `--allow-maps` when publishing them is intended |
| `duplicate-chunk-content` | info | Two or more JavaScript or CSS files have the same SHA-256 hash. The usual cause is a file copied into the output by two plugins, or two entry points that each bundle the same module. A page that loads both downloads the same code twice. Empty files are not reported |
| `no-budget` | info | Pages that no budget applies to: no pattern matches and there is no `default`. They are measured and shown, but nothing guards them |

Notes add what is not a finding: chunk names a manifest imports but does not define, file names in Next.js manifests outside `static/`, links in the folder that point outside it or to a folder (neither is followed), and pages added or removed since the baseline.

## The report

Each report shows the inputs, a summary line (the compression, the number of pages, lazy chunks and files, and the total raw, gzip and brotli size of all JavaScript and CSS in the folder), a table of the pages with their up-front JS, CSS and total, their budget and status (and growth, with a baseline), a table of the lazy chunks, the ten largest files by the chosen compression with all three sizes, then the findings and notes, and the gate.

## Severity and the gate

`--fail-on error`, the default, makes the run exit with `1` when any error is found. `--fail-on warning` also fails on warnings. Info never fails a run.

The method has no randomness and no network access: the same files, with the same Node version, always give the same report, and any change in the report comes from a change in the files.
