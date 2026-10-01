# Contributing

Every change goes through a pull request and is reviewed before it is merged. The pipeline runs the tests on Linux, Windows and macOS, the repository checks, CodeQL, and a secure development check of the repository itself.

Commit messages in this repository follow Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `ci:`, with `!` for a breaking change.

## Changing a check or how a page is counted

1. Describe the change in docs/method.md first: what the check reports, its severity, and why it matters for the speed of a page, with the part of the Vite guide, the Next.js build output or web.dev it follows. Where the tool makes its own choice (which files of a lazy chunk are subtracted, which Next.js files are left out, decimal kilobytes), say so and say why.
2. Add a test with the manifest and the file sizes written inline, where the result can be worked out by hand. Tests of the checks use sizes written by hand, not compressed output, so they do not depend on the zlib build.
3. Text from the input goes through `safeText` before it reaches a finding or a note, and every path from a manifest goes through `insidePath` before a file is opened.
4. A finding id, once released, keeps its meaning: pipelines and other tools read it from the JSON and CSV reports. The JSON report is also read back as a `--baseline`, so a change to its shape must keep older reports readable.

## Adding a manifest format

1. Read only what the format records. When a file or a route cannot be placed with certainty, leave it out and say so in a note; never guess sizes.
2. Keep every path inside the build output folder, and refuse the run when a manifest names one outside it.
3. Bound the work: no recursion without a limit, a set of visited entries for every graph walk, and the same size limits as the other readers.

## Rules for the code

- No runtime dependencies. Node 22 or newer and nothing else.
- The tool reads the files it is given and writes only to the screen. It opens no network connection, runs no build and no other program, and never imports or evaluates a file from the build.
- Source files stay ASCII; write any other character in a pattern as a `\u` escape.
- Never commit a real project's build output, even as a fixture. Write small made-up files with filler content.

## Before you open the pull request

```
npm test
npm run check
npm run example
```
