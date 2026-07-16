---
category: Fixed
---

- **The Oxlint ruleset is now actually enforced, and broadened.** The lint rules lived in a root
  `oxlintrc.json`, but `vp lint`/`vp check` read Oxlint config from the `lint` block of
  `vite.config.ts` and never from that file — so the ruleset was **dead**, and `oxc/no-barrel-file`
  (ADR-0070) was silently unenforced. Moved the whole ruleset into `vite.config.ts` where vp reads it
  (restoring the no-barrel rule), deleted the dead `oxlintrc.json`, and dropped its now-redundant
  entry from `tooling/affected-lint` (`vite.config.ts` already forces a whole-repo re-lint). While
  there, broadened coverage: enabled the `suspicious` and `perf` rule categories as **warnings**
  (advisory — they do not fail the gate), with the two noise-flood rules turned off
  (`typescript/no-unsafe-type-assertion`, `eslint/no-await-in-loop`) so the high-signal tail stays
  visible. Plugins are listed explicitly (`typescript`, `unicorn`, `oxc`) — no `react`/`jsx-a11y`
  (Svelte app, zero JSX). Confirmed the type-aware pass's tsconfig `include` patterns are already
  scoped (`src/**/*.ts`), so no change was needed there. Ruleset home + rationale:
  [`docs/conventions/typescript.md`](docs/conventions/typescript.md).
