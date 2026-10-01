# 1. Read the build output, do not run the build

## Context

The tool needs to know which files each page of a front-end app loads and how large they are. The obvious way to get that is to run the build itself: call Vite or Next.js with a plugin that records the chunks, or load the project's bundler configuration and ask it. That makes the tool depend on the bundler, its version and its plugin interface, which change often, and it means running the project's build scripts and every plugin and dependency they load, with the tool's own permissions, every time the check runs. A pull request can change those scripts and dependencies. It also doubles the build time in a pipeline that already builds the app, and the result would describe a build made by the tool rather than the build that will be deployed.

## Decision

The tool reads what a finished build leaves behind: the output folder and the manifest the bundler wrote into it (a Vite manifest, or the client manifests of a Next.js build). Without a manifest, `--glob` measures the files alone. It never runs a build, a bundler, `npm` or any other program, never imports or evaluates a file from the build, and refuses manifest paths that lead outside the output folder.

## Consequences

The check measures exactly the files that will be deployed, adds seconds rather than minutes to a pipeline, and works with any version of the bundler that writes the manifest format it reads. It runs anywhere Node runs, with no network access and no access to the project's dependencies, and the same files always give the same report, so it can gate a pull request that changes the code, the dependencies or the budgets. No input can make it run code. The cost is that it knows only what the manifest records: which modules fill a chunk, why a dependency was included, and how the files behave in a browser stay outside it. The README and docs/limits.md say so, and recommend a bundle visualiser and browser measurements as separate steps.
