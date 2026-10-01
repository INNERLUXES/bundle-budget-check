# Security

## Reporting a problem

Write to info@innerluxes.dev with the subject line "bundle-budget-check security", or use private vulnerability reporting on this repository. Please do not open a public issue for a vulnerability.

Include a small made-up build folder and manifest (filler file contents, no real project's code, customers, keys or tokens) that shows the problem, what you expected and what happened.

## Scope

In scope:

- an input that makes the tool open a network connection, run a program, or read a file it was not given, including a file outside `--dir` reached through a manifest path or a symbolic link
- an input that makes the tool run or evaluate code from the build output
- an input that makes the tool hang, take very long, or use unbounded memory or stack, such as an import cycle or a deep folder
- text from a file name, a manifest or a budget file that breaks a Markdown table, injects a formula into a CSV report, or rewrites the terminal through control or direction characters
- a budget file with a mistake that is silently ignored, so a run passes with a budget missing
- a page reported within its budget when the rule in docs/method.md says its up-front files add up to more, or a missing file that is not reported

Out of scope: how fast the pages are in a browser, scripts added outside the build, and what the deployed server sends (docs/limits.md lists what a size check cannot see).

Read [docs/threat-model.md](docs/threat-model.md) for the rest.
