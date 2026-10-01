# Secure defaults

The default run is the safe run. Nothing below needs a flag, and none of it can be switched off.

## How the tool behaves by default

- **No network.** The tool reads the files it is given and sends nothing anywhere. It does not fetch a manifest, a baseline or a page, does not resolve host names, does not look up package sizes in a registry, and does not check for updates. An address given where a folder or a file is expected is refused. It can run in a locked-down build job with no outbound access at all.
- **No build, no commands.** The tool never runs the bundler, `npm`, `next build` or any other program. It reads the output of a build that has already run. No path, name or pattern from the input is ever put on a command line, and no file from the build is imported, evaluated or parsed as code: each one is read as bytes, compressed in memory, and hashed.
- **No dependencies.** Node 22 or newer and nothing else, so there is no third-party code in the path of build output that may hold unreleased features, internal host names or keys that a bundler inlined by mistake.
- **Paths stay inside the folder.** Every file name taken from a manifest is checked before anything is opened: absolute paths, drive letters, UNC paths, address schemes, `..` parts and NUL characters stop the run. A manifest cannot make the tool read a file outside `--dir` (or outside the `--next` folder).
- **Links are not trusted.** In the build output folder, a symbolic link or junction is read only when its real target is a file inside the folder. A link that leads outside is skipped and listed; a link to a folder is never followed, so a loop of links cannot run. When a file is read, the real path of the whole path is checked again, so a linked folder on the way cannot lead outside either.
- **Bounded input.** A file over 50 MB stops the run before it is read, and so does a manifest, budget file or baseline over 50 MB. More than 20,000 files in the folder, or more than 20,000 entries in a Vite manifest, stop the run. The import closure visits each chunk once, without recursion, so an import cycle or a deep chain of imports cannot hang it or exhaust the stack.
- **Clean output.** Text from file names and manifest keys has control characters, line separators and direction controls removed and its length capped before it reaches a report, so a hostile file name cannot rewrite the terminal or reorder what a reviewer reads. Markdown cells escape pipes, backslashes and line breaks. CSV cells are quoted as RFC 4180 says, and a cell that a spreadsheet would read as a formula gets a leading `'`. No report renders a name as a link.
- **Strict configuration.** The budget file is checked before anything is measured. An unknown key (a typo such as `"defualt"` or `"javascript"`), a size that cannot be read, or a compression that does not exist stops the run with exit code 2 and the reason, instead of a run that passes because the budget it meant to set was ignored. A baseline that is not a JSON report of this tool is refused the same way.
- **Fails closed.** A missing option, a missing folder or manifest, a manifest path that leaves the folder, a file over the limit, or too many files stops the run with exit code 2 and the reason, instead of a clean report about part of the build. A file the manifest names but the folder does not hold is an error, never a size of zero.
- **The gate is on.** Without any option, an error makes the run exit with `1`: a page over its budget, a file over `files.max`, a missing file, or growth over `--max-growth`. A pipeline that adds the tool is protected from the first run; there is no report-only mode to forget to turn off.
- **Source maps are flagged.** `.map` files in the output are a warning unless `--allow-maps` is given, because a public source map publishes the original source, comments and all.
- **Writes nothing to disk.** The report goes to the screen. Redirect it to a file, or to the job summary, only when you need to keep it.

## Running it in a pipeline safely

1. Build first, in an earlier step of the same job, from the same commit, then point the tool at the output folder. Do not let the job download a build or a manifest from an address that a pull request can change.
2. Run the check with read access to the repository and nothing else: no deploy keys, no registry tokens, no write permissions. It needs none, and the build step that comes before it should not leave secrets in the output folder either.
3. Use the tool from a pinned commit. `npx --yes github:INNERLUXES/bundle-budget-check#<commit>` runs exactly the code that was reviewed, not whatever the default branch holds on the day.
4. Keep the budget file in the repository, next to the code it guards, and protect it with CODEOWNERS. A pull request that raises a budget should be reviewed as a decision to make the app heavier, by someone who can say yes to that.
5. Keep the default `--fail-on error`. Add `--fail-on warning` once the build is clean, so that new source maps and lazy chunks over budget stop a merge too.
6. Write the Markdown report to the job summary, so the reviewer sees the tables next to the change, and keep the exit code as the gate.
7. For growth, store the JSON report of the main branch as a build artifact on every merge and pass it as `--baseline` on pull requests. Build the baseline and the check with the same Node version, so that compressed sizes are comparable.
8. Set `--max-growth` low enough to notice a new dependency (a few percent, or a size such as `5 KB`) and raise the page budget on purpose when growth is intended, rather than raising `--max-growth` until the check passes.
9. Choose the compression once, from what your server or CDN actually sends, write it into the budget file, and review a change to it like a change to the budgets.
10. Run the check on every pull request, not only before a release. The pull request that adds a dependency is the cheapest place to ask whether it is worth its size.

## Setting budgets the tool can check well

1. Start from the current build. Run the tool without `--config`, read the page table, and set each budget a little above today's size. A budget that the build already breaks on day one gets raised instead of enforced.
2. Budget the pages that matter most first: the landing pages that visitors from search and ads see, sign-up, checkout. Give heavier, signed-in pages their own, looser budgets with patterns, so that they do not set the bar for everything.
3. Keep a `default`. It covers every page that has no budget of its own, including pages added after the budget file was written, and stops `no-budget` from growing quietly.
4. Budget JavaScript and CSS apart as well as together. They cost differently: CSS blocks the first render, JavaScript delays interaction. A total alone lets one hide behind the other.
5. Set `files.max`. A single very large chunk is usually a dependency imported whole or a chunking rule gone wrong, and it hurts caching as well as the first load.
6. Set `lazy.max` for routes and dialogs loaded on demand, so that code moved out of the main bundle does not simply grow without limit somewhere else.
7. Leave a margin of a few percent. Compressed sizes can move by a few bytes between Node versions, and a budget set to the exact current size fails on noise.
8. Write sizes in the unit you mean. `KB` is 1000 bytes and `KiB` is 1024; the difference is 2.4 percent, enough to decide a tight budget.
9. Lower a budget after a slimming pass. When a page gets lighter, move its budget down to the new size plus the margin, so that the savings are kept rather than spent again by the next dependency.

## Keeping a React build lean

The tool tells you that a page is too heavy; these are the usual ways to make it lighter, in the order they tend to pay off.

1. **Find what is big.** Start with the largest files and the pages over budget, then open the build in a bundle visualiser to see which modules fill each chunk. Large libraries imported whole (date, utility, icon and charting libraries) are the usual cause.
2. **Import less.** Import single functions or icons rather than whole packages, prefer libraries that support tree shaking, and remove dependencies that duplicate something the platform now does (dates and number formatting with `Intl`, fetching with `fetch`, many polyfills).
3. **Split by route.** Load routes, modals and rarely used features with `import()` and `React.lazy`, so that a page loads only what it shows. Watch `lazy.max` so the split-off code stays in check.
4. **Load third parties late.** Analytics, chat and other third-party scripts are not in the bundle, but they compete for the same network and main thread. Load them after the page is interactive, and budget them separately.
5. **Ship less CSS.** Remove unused styles, split CSS by route with the code that uses it, and avoid importing a whole component library's stylesheet for a few components.
6. **Keep source maps out of the deploy.** Upload them to the error tracker during the build and leave them out of the public folder, unless publishing them is a decision you have made.
7. **Serve it compressed.** Precompress with brotli at the highest level where the CDN supports it, and make sure every JavaScript and CSS response is compressed; the budgets assume it.

## Sharing a report safely

1. A report shows file names, manifest keys and route names from the build. For a public site that is harmless. Before a launch it can show the names of unreleased routes, features or pages: share the report with the people who can see the code.
2. The report never shows file contents. It shows names and sizes only; content hashes are used to find duplicates and are never printed.
3. Prefer the Markdown or text report over the build output itself when you send the result to another team, so only the numbers leave the pipeline.
