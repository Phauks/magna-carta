---
category: Added
audience: internal
---

**`pnpm run lint:hard-rules` — the linter rules this repository can enforce now, in a pass that can fail.** The Oxlint ruleset is almost entirely advisory by design (`suspicious` and `perf` warn, `correctness` keeps its inherited severity), and the consequence nobody chose is that the gate's most expensive job — a whole-repo type-aware pass measured at about forty-five minutes — can fail on exactly one rule, `oxc/no-barrel-file`. Everything else it finds is a warning in a list of roughly eight hundred.

Three rules move out of that list and into a pass that fails:

- **`import/no-cycle`**, held at 36 and falling only. Nothing in the repository looked for a cycle before this: the project-reference check verifies that references exist, not that they form a directed acyclic graph, and a bundler resolves a cycle silently by handing one side a half-initialised module. The thirty-six sit in twenty-nine files, concentrated in the worker's route graph and the web app's calendar and directory screens.
- **`vitest/no-focused-tests`** and **`vitest/no-disabled-tests`**, held at zero, which is free because the tree is already clean. A stray `.only` is green, silent, and takes the rest of its file's coverage with it — and it can ride a whole review here, because the battery is asked for rather than automatic.

Six seconds over about 3,900 files, no type-aware pass, so it sits in the always-on governance tier. It **proves its own invocation**: every rule is run against a fixture written to trip it before its count on the repository is believed, because a wrapper whose plugin flag was renamed reports a clean tree forever.

The `import` and `vitest` plugins deliberately stay out of the shared ruleset. Enabling a plugin switches on everything it carries at its category severity, which adds warnings to the forty-five-minute pass and moves nothing from advisory to enforced.
