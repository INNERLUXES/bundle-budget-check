# bundle-budget-check

Checks the JavaScript and CSS that each page of a front-end build loads against size budgets, so bundles cannot grow unnoticed. It reads the build output of a React app built with Vite or Next.js (or any folder of `.js` and `.css` files), works out what each page downloads before it can run, measures it raw, gzip and brotli, and fails the pipeline when a page goes over its budget.

A React app rarely gets slow in one commit. It gets slow one dependency at a time: a date library here, a charting package there, an icon set imported whole instead of one icon, a polyfill nobody needs any more. Each change adds a few kilobytes and looks harmless in review, because the reviewer sees the source, not the bundle. Months later the home page ships twice the JavaScript it did, phones on a slow network wait seconds before the page responds, and nobody can say which change did it. Every byte of JavaScript a page loads up front has to be downloaded, parsed and run before the page can react to a tap, which is what [Core Web Vitals](https://web.dev/articles/vitals) measure. A budget in CI turns that slow drift into a failed check on the pull request that caused it, while the change is still small and its author still remembers why it was made.

- Every finding has an id, a severity (error, warning, info), the page or file it is about, and a plain message with the size, the budget and how much over it is.
- It reads a Vite manifest (`build.manifest: true`), the client manifests of a Next.js build, or a plain folder; for a Vite build it also reports the chunks a page loads later, through a dynamic import.
- A file shared by several pages is measured once and counted once for each page that loads it; import cycles in a manifest end without a loop.
- It reads files only. It never runs the build, a bundler or any other program, and opens no network connection.
- Plain JavaScript, no dependencies; the same files always give the same report.

```
npm test
```

```
ℹ tests 53
ℹ pass 52
ℹ fail 0
ℹ skipped 1
```

The skipped test creates a symbolic link to a file. It runs where the system allows that (Linux, macOS, Windows with developer mode) and is skipped elsewhere.

## Quick start

Requires Node 22 or newer. There is nothing to install.

```
git clone https://github.com/INNERLUXES/bundle-budget-check.git
cd bundle-budget-check
node bin/bundle-budget-check.js --dir examples/vite-dist --config examples/budget.json
```

Or without a clone, after `vite build`:

```
npx --yes github:INNERLUXES/bundle-budget-check --dir dist --config budget.json
```

`examples/vite-dist` is the output of a made-up React app built with Vite: two pages (`index.html` and `admin.html`), a vendor chunk, a shared UI chunk, a charting chunk, two pages loaded on demand, their CSS, a source map, and a polyfill copied twice. The files are filler text, written so that their sizes and the way they compress are close to real build output. `examples/budget.json` gives that build room to grow, and the run passes with one warning (the source map) and one info line (the copied polyfill).

`examples/budget-tight.json` sets the budgets the way a team would after a slimming pass, and `examples/baseline.json` is the JSON report of the previous build:

```
node bin/bundle-budget-check.js --dir examples/vite-dist --config examples/budget-tight.json --baseline examples/baseline.json --max-growth 5%
```

```
bundle-budget-check: Vite manifest examples/vite-dist/.vite/manifest.json, folder examples/vite-dist, budget examples/budget-tight.json, baseline examples/baseline.json
sizes: gzip; 2 pages, 2 lazy chunks; 9 JS and 4 CSS files (raw 268.22 KB, gzip 71.13 KB, brotli 62.26 KB); 1 source map
findings: 4 error, 3 warning, 2 info

Page        JS        CSS      Total     Budget (JS / CSS / total)  Status           Growth
index.html  35.37 KB  3.62 KB  38.99 KB  30 KB / 5 KB / 34 KB       over: js, total  +3.99 KB (+11.4%)
admin.html  34.49 KB  2.69 KB  37.17 KB  -                          no budget        +473 B (+1.3%)

Lazy chunk              JS        CSS    Total     Budget  Status
src/pages/Reports.tsx   21.25 KB  863 B  22.11 KB  15 KB   over
src/pages/Settings.tsx  2.28 KB   0 B    2.28 KB   15 KB   ok

Largest files (by gzip)          raw       gzip      brotli
assets/vendor-react-9d8e7f6a.js  92.19 KB  23.51 KB  20.6 KB
assets/chart-6a5b4c3d.js         64.14 KB  16.59 KB  14.61 KB
assets/shared-ui-1a2b3c4d.js     24.39 KB  6.76 KB   6.01 KB
assets/index-4f1a2b3c.js         18.01 KB  5.1 KB    4.51 KB
assets/Reports-2c3d4e5f.js       16.21 KB  4.66 KB   4.12 KB
assets/admin-8e7d6c5b.js         14.34 KB  4.22 KB   3.7 KB
assets/index-7c6b5a4d.css        12.05 KB  2.38 KB   2.04 KB
assets/Settings-0f1e2d3c.js      7.15 KB   2.28 KB   1.99 KB
assets/admin-3b4c5d6e.css        6.08 KB   1.44 KB   1.19 KB
assets/shared-ui-5e6f7a8b.css    5.06 KB   1.25 KB   1.03 KB

ERROR     over-budget              index.html: up-front JS is 35.37 KB gzip, 5.37 KB (17.9%) over the 30 KB budget

ERROR     over-budget              index.html: up-front total (JS and CSS) is 38.99 KB gzip, 4.99 KB (14.7%) over the 34 KB budget

ERROR     file-over-budget         assets/vendor-react-9d8e7f6a.js is 23.51 KB gzip, 3.51 KB over the files.max budget of 20 KB

ERROR     growth                   index.html grew from 35 KB to 38.99 KB gzip (+3.99 KB, +11.4%) since the baseline, more than --max-growth 5%

WARNING   growth                   admin.html grew from 36.7 KB to 37.17 KB gzip (+473 B, +1.3%) since the baseline

WARNING   lazy-over-budget         lazy chunk src/pages/Reports.tsx adds 22.11 KB gzip when it loads, 7.11 KB over the lazy.max budget of 15 KB

WARNING   source-map-shipped       1 source map in the build output folder would be deployed with it and publish the original source: assets/index-4f1a2b3c.js.map. Leave them out of the deploy, or pass --allow-maps when that is intended

INFO      duplicate-chunk-content  2 files have the same content (1.05 KB gzip each): assets/legacy-a1b2c3d4.js, assets/legacy-e5f6a7b8.js; a page that loads more than one of them downloads the same code twice

INFO      no-budget                1 page has no budget: admin.html; add a "default" budget or a matching pattern under "entries"

GATE: FAIL - 4 errors
```

The exit code is `1`. The page table is the place to start: `index.html` loads the vendor chunk, the shared UI chunk and its own file up front, and the vendor chunk alone is two thirds of its JavaScript. The lazy chunk `src/pages/Reports.tsx` is counted without the vendor and UI chunks, which every page that opens it has already loaded; what it adds is mostly the charting chunk. Compressed sizes come from the zlib inside Node and can differ by a few bytes on another Node version; raw sizes do not.

## Usage

```
bundle-budget-check --dir <build output> [--manifest <file> | --glob] [options]
bundle-budget-check --next <.next folder> [options]
```

```
--dir <folder>          the build output folder, such as dist
--manifest <file>       the Vite manifest (default: <dir>/.vite/manifest.json, then <dir>/manifest.json)
--next <folder>         a Next.js .next folder: routes from build-manifest.json and
                        app-build-manifest.json, files under static/
--glob                  no manifest: every .js and .css file in --dir is measured alone
--config <file>         the budget file (JSON); without it every page is reported as no-budget
--compression <name>    gzip, brotli or raw (default: the budget file's, else gzip)
--baseline <file>       a JSON report of an earlier run, to report growth per page
--max-growth <limit>    growth above this is an error, as a percentage (5%) or a size (10 KB)
--allow-maps            do not warn about .map files in the build output
--format <name>         text, markdown, json or csv (default: text)
--fail-on <level>       exit with 1 when a finding is at this level or above: error or warning
                        (default: error)
--help                  show the usage
--version               show the version
```

**What a page loads up front.** For a Vite build, each manifest entry with `"isEntry": true` is a page. It loads its own file, every chunk it imports statically, every chunk those import, and so on, plus the CSS of each of them; each file once. Chunks reached only through `import()` are lazy chunks, reported in their own table and measured as the files they add to what the pages that open them have already loaded. For a Next.js build, each route in `build-manifest.json` loads its own files and those of `/_app`; each page of `app-build-manifest.json` loads the root files, the layout of every folder above it and its own files. With `--glob`, each file is measured alone. [docs/method.md](docs/method.md) gives the details.

## Budget file

```json
{
  "compression": "gzip",
  "default": { "js": "170 KB", "css": "50 KB", "total": "220 KB" },
  "entries": {
    "admin.html": { "js": "60 KB" },
    "/blog/*": { "js": "120 KB" }
  },
  "files": { "max": "100 KB" },
  "lazy": { "max": "120 KB" }
}
```

- `compression`: which size the budgets are written in: `gzip` (the default), `brotli` or `raw`. Use the one your server or CDN sends. `--compression` overrides it.
- `default`: the budget for every page; `js`, `css` and `total` (both together). Any of them can be left out.
- `entries`: budgets for pages by name: the manifest key for Vite (`index.html`, `src/main.tsx`), the route for Next.js (`/`, `/blog/[slug]`), the file path with `--glob`. `*` matches any characters except `/`, `**` matches any characters including `/`. A pattern written exactly as the name wins; otherwise the first pattern that matches, in the order written. Limits a pattern leaves out come from `default`.
- `files.max`: the largest any single JavaScript or CSS file may be.
- `lazy.max`: the most a lazy chunk may add when it loads.

Sizes are a number of bytes or a text with a unit: `B`, `KB` (1000 bytes), `MB` (1000 KB), `KiB` (1024 bytes) or `MiB` (1024 KiB). KB and MB are decimal, as browser developer tools and most build tools print them, so a budget of `170 KB` means 170,000 bytes. Write `KiB` when you mean 1024.

## Checks

| Id | Severity | What it reports |
| --- | --- | --- |
| `over-budget` | error | A page whose up-front JS, CSS or total is above its budget, with the size, the budget and how much over |
| `file-over-budget` | error | A single JavaScript or CSS file above `files.max` |
| `missing-file` | error | A file the manifest names that is not in the build output folder, or that is a link pointing outside it |
| `growth` | warning / error | A page that grew since the `--baseline` report; an error when it grew more than `--max-growth` |
| `lazy-over-budget` | warning | A lazy chunk that adds more than `lazy.max` when it loads |
| `source-map-shipped` | warning | `.map` files in the build output folder, which would be deployed with it, unless `--allow-maps` |
| `duplicate-chunk-content` | info | Two or more output files with exactly the same content |
| `no-budget` | info | Pages that no budget applies to |

[docs/method.md](docs/method.md) gives each check and why it matters.

## Formats

- `text`: for a terminal: the page table, the lazy chunks, the ten largest files, then the findings, errors first.
- `markdown`: the same tables and the findings for a pull request comment or the job summary. Pipes and line breaks in names from the build are escaped, so a file name cannot break a table.
- `json`: the whole report, with the raw, gzip and brotli size of every page. Keep it as the `--baseline` of the next run.
- `csv`: one row per page, per lazy chunk and per finding, with sizes in bytes, quoted as RFC 4180 says. A cell that starts with `=`, `+`, `-` or `@` gets a leading `'`, so a spreadsheet does not run it as a formula.

## Exit codes

`0` no finding at the `--fail-on` level, `1` at least one such finding (by default: an error), `2` a usage or input error (a missing option, a missing folder or manifest, a budget file with an unknown key or a size that cannot be read, a manifest path that leaves `--dir`, a file over 50 MB, more than 20,000 files).

## In a pipeline

Build the app, then check the build output in the same job, and fail the job when a page is over its budget:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
- uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
  with:
    node-version: 22
- run: npm ci
- run: npm run build
- name: Check the bundle budgets
  run: |
    npx --yes github:INNERLUXES/bundle-budget-check --dir dist --config budget.json --format markdown >> "$GITHUB_STEP_SUMMARY"
```

The step summary shows the tables; the exit code fails the job. Turn on `build.manifest` in `vite.config` so the pages and their imports can be followed; without a manifest, use `--glob`. For Next.js, run `next build` and give `--next .next`. To see growth per pull request, keep the JSON report of the main branch (as a build artifact or in the repository) and pass it as `--baseline`, with `--max-growth` once the numbers have settled.

## Limits

Size is not speed. The tool counts the bytes a page downloads; it does not see how long they take to parse and run on a slow phone, the network, the cache, scripts that a tag manager or a third party adds at run time, or the difference server rendering makes. Next.js manifests are not a public format and change between versions. [docs/limits.md](docs/limits.md) lists these, with the size limits.

## Background

- How React apps are built and kept fast as they grow, with budgets like these in the pipeline: [React web development](https://innerluxes.dev/web-development/react).

## License

MIT
