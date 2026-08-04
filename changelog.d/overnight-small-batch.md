---
category: Added
---

**`pnpm fix:scoped` — the formatter, pointed at the diff instead of the repository.** A bare
`vp check --fix` takes no paths and rewrites everything; it has three times landed dozens of files
nobody in the change had touched, including the `sort()` → `toSorted()` autofix that breaks a package
whose compile target predates it. `pnpm fix:scoped` (`tooling/check-scoped/fix.mjs`) applies the
formatter and the lint autofixes to exactly the change set `pnpm check:scoped` verifies — markdown and
the other prose/data formats included — and the two now share one change-set implementation, so the
files fixed and the files checked cannot drift apart. Each pass receives only the paths its tools can
parse (`.svelte` is lint-only, markdown/JSON/CSS/HTML/YAML/TOML format-only, scripts both);
`--no-lint` formats without autofixing and `--base <ref>` re-scopes the diff, as on the gate.

Also in this batch: `magna-carta-engine-host`'s magic-byte detection gained a **constant-stack
regression guard** — `detect` now runs in a test on a deliberately 64 KiB thread stack, so an
implementation that recurses into a container or copies its input into a frame fails on every machine
rather than as an occasional stack overflow on a loaded one.
