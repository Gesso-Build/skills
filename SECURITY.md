# Security

## Reporting a vulnerability

Use GitHub's private vulnerability reporting (the "Report a
vulnerability" button under this repository's Security tab), or email
[hello@gesso.build](mailto:hello@gesso.build). You will hear back within
a few business days. Please do not open a public issue for anything
exploitable.

## Scope

The detector parses HTML as text. It never executes, renders, or fetches
anything: no network access, no child processes, no install hooks, and a
single runtime dependency (`node-html-parser`). Reports we consider
security-relevant include anything that breaks those invariants: a way
to make the detector or fixer execute or fetch content, a way to smuggle
unbounded or unsanitized document text past the excerpt bounds and into
report output, or a supply-chain issue in the published npm package.

The bounded prompt-injection surface inherent to quoting scanned
excerpts is documented in the [README's Security
section](README.md#security) and is accepted behavior; a report
demonstrating an actual bypass of the excerpt bounds is very welcome.

## Supported versions

The latest version published to npm receives fixes.
