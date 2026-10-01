# Threat model

## What the tool touches

- It reads the build output folder given with `--dir` (or the `static/` folder inside the folder given with `--next`), the manifest, the budget file and the baseline named on the command line, and only those. Nothing inside them is run, imported, fetched or followed as a link.
- It writes only to the screen (standard output and standard error).
- It opens no network connection, runs no build, no bundler and no other program.

## What the input may hold

A build output folder is produced by a bundler from the project's source and from every dependency in `node_modules`, including dependencies of dependencies, any of which can add files, plugins or postinstall scripts. The manifest is a JSON file written by that build. The budget file and the baseline come from the repository or from an earlier pipeline run, and a pull request from an outside contributor can change any of them. The tool treats all of them as possibly hostile. A manifest can name paths meant to reach outside the folder (`../../.ssh/id_rsa`, `/etc/passwd`, `C:\Users\...`). A folder can hold symbolic links to files elsewhere on the build machine, or a link that points back to its own parent. A file name can carry text meant to break a report: formulas for a spreadsheet, Markdown that hides a row, or terminal escape sequences. A folder or a file can be large enough to exhaust memory or time.

## What could go wrong, and what stops it

| Risk | Control |
| --- | --- |
| A manifest names `../../secret`, an absolute path, a drive letter, a UNC path or a `file://` address, and the tool reads and measures a file outside the build | Every path from a manifest goes through `insidePath`: absolute paths, drive letters, leading slashes or backslashes, address schemes, `..` parts and NUL characters stop the run with exit code 2 before any file is opened |
| A symbolic link or junction in the build folder points to a file outside it, and its size or content hash reveals something about that file | The folder walk resolves every link; a link whose real path is outside the real path of `--dir` is not read and is listed in a note. Reading a file checks the real path of the whole path, so a linked folder on the way cannot lead outside either |
| A link to a folder, or a loop of links, makes the walk run forever | Links to folders are never followed; they are listed in a note. Ordinary folders cannot form a loop |
| A huge folder, a huge file or a manifest with very many entries exhausts memory or time | Files over 50 MB stop the run before they are read; more than 20,000 files, or more than 20,000 manifest entries, stop the run |
| An import cycle in a manifest makes the closure run forever or overflow the stack | The closure is an iterative walk with a set of visited chunks; each chunk is visited once, and no recursion is used |
| A crafted pattern in the budget file takes exponential time to match | Patterns are turned into regular expressions with only `[^/]*` and `.*` and escaped literal text; they are matched against short page names |
| Text from a file name or a manifest key rewrites the terminal through escape sequences, or reorders text with direction characters | Control characters (C0 and C1), line and paragraph separators and Unicode direction controls are replaced by a space before any text reaches a report, and the length is capped |
| A file name breaks the Markdown table in the job summary, or injects Markdown that hides a finding | Pipes, backslashes and line breaks are escaped in every table cell |
| A CSV report runs a formula when opened in a spreadsheet | Cells that start with `=`, `+`, `-`, `@`, a tab or a carriage return get a leading `'`; every cell is quoted as RFC 4180 says |
| A manifest from another build, or a folder with files removed, gives a clean report on sizes that are too low | A file the manifest names that is not in the folder is a `missing-file` error, never a size of zero that passes quietly |
| A wrong file is given as the budget file or the baseline, and the run passes with no budgets | An unknown key in the budget file, a size that cannot be read, or a baseline that is not a report of this tool stops the run with exit code 2 |
| An address is given where a folder or file is expected, and the tool is turned into a fetcher | Addresses such as `https://...` are refused for every path option; the tool has no code that opens a connection |
| A JavaScript file in the build is executed while it is measured | Files are read as bytes and compressed; they are never imported, evaluated or parsed as code |

## Out of scope

Whether the budgets are the right ones for the business, what the deployed server sends, scripts added outside the build, and who may change the budget file. docs/limits.md lists what a size check cannot see.
