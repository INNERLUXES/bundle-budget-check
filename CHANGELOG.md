# Changes

## 1.0.0

First release.

- Checks the JavaScript and CSS each page of a front-end build loads up front against size budgets, so bundles cannot grow unnoticed. Reads the build output and its manifest; never runs the build.
- Reads a Vite manifest (`.vite/manifest.json` or `manifest.json`): each entry's file, its static imports followed recursively with cycle protection, and their CSS, each file counted once per page. Chunks loaded through `import()` are reported as lazy chunks, measured as the files they add to what their pages already loaded.
- Reads a Next.js build (`--next`): routes of `build-manifest.json` with the files of `/_app`, and pages of `app-build-manifest.json` with the root files and every layout above them; only files under `static/` are counted.
- Measures folders without a manifest with `--glob`, each `.js` and `.css` file alone.
- Measures every file raw, gzip (level 9) and brotli (quality 11), once per file.
- Budget file in JSON: `compression`, `default`, `entries` with `*` and `**` patterns, `files.max` and `lazy.max`; sizes in bytes or with `B`, `KB` and `MB` (decimal) or `KiB` and `MiB` (binary). Unknown keys and unreadable sizes stop the run.
- Eight checks: `over-budget`, `file-over-budget`, `missing-file`, `growth` (an error over `--max-growth`), `lazy-over-budget`, `source-map-shipped`, `duplicate-chunk-content` and `no-budget`.
- Growth per page against the JSON report of an earlier run (`--baseline`), as a percentage or a size.
- Reports as text, Markdown, JSON and CSV, with a table per page, the lazy chunks and the ten largest files; `--fail-on` for a pipeline gate.
- Safe input: manifest paths that leave `--dir` are refused, symbolic links outside the folder and links to folders are not followed, files over 50 MB and more than 20,000 files stop the run, and control characters are removed from every name shown.
- Release packages come with a CycloneDX SBOM, SHA-256 checksums and a build provenance attestation.
