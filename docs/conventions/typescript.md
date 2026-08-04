# TypeScript conventions

**Status:** Stub — to be written when the repo scaffold lands (Phase 0).

**Scope (single home for):** TypeScript-specific style, tooling, and idioms. Shared cross-language principles live in [`code-style.md`](code-style.md); don't repeat them here.

**Authoritative context:** the [white paper](../Magna-Carta-White-Paper.md) — _Delivery model_ (Workers/Hono, code-as-contract, Svelte 5 SPA). API-contract specifics live in [`api.md`](api.md); UI specifics in [`ui-design.md`](ui-design.md).

**To document:**

- **Oxlint** (`vp lint`) + **Oxfmt** (`vp fmt`; Prettier interim until Oxfmt is GA), with `vp check` running format + lint + **tsgolint** type-check in one pass: rules enforced, how to run, the CI gate.
- **Current scaffold reality (Phase 0):** `vp check` runs **format + lint + tsgolint type-check** — type-check is enabled via `lint.options.typeCheck: true` (with `typeAware: true`) in the root `vite.config.ts`, so a real TS error in a `.ts` file fails `vp check`. tsgolint does **not** parse `.svelte` files, so the SvelteKit app's `.svelte` (and its `.ts`) source is type-checked by **svelte-check**. The full quality gate runs through the root `check` package script (`pnpm check` / `pnpm run check`), which is `vp check && pnpm --filter @magna-carta/web check`; the second command is `svelte-check`. CI must invoke `pnpm check` (the full gate: TS via tsgolint + `.svelte` via svelte-check), not bare `vp check`, because bare `vp check` does not cover `.svelte` files. As more packages are added, each app/package that owns `.svelte` source wires its own `svelte-check` into the gate; the worker slice (E3) adds the worker's build/type-check tasks.
- Type discipline: `strict` settings, no implicit `any`, prefer inference; when explicit types are required.
- **zod** as the schema/validation source of truth (feeds the API contract — see [`api.md`](api.md)).
- Async patterns on Workers (no Node assumptions; Web APIs / `fetch`; streaming).
- **Svelte 5 runes** conventions (`$state`/`$derived`/`$effect`), component structure, and store/cache patterns.
- Module/import ordering. The **barrel-file / module-reference policy is decided** — see _Module references & barrel files_ below (ADR-0070).
- Error handling: typed errors, result envelopes, and the user-visible Error ID boundary (the _Observability_ layer).
- Naming: files, types, functions, Worker bindings, D1 tables/columns.

---

## Module references & barrel files (decided — ADR-0070)

**No convenience barrel files.** Enforced structurally (not by discipline):

- **Within a package**, import the specific source module — `import { roundTax } from './trust/rounding.ts'` — never an intermediate `index.ts` re-export hub. Barrels force Vite's dev server to crawl/transform every re-exported module for a single import, break tree-shaking when they mix inline + re-exports (Rolldown can pull a whole barrel + its heavy deps into a shared chunk), and breed circular dependencies and slow `tsc`/IDE.
- **A package's public API is its `package.json` `exports` map** — one small, **curated, side-effect-free** entry plus explicit subpaths (`@magna-carta/money`, `@magna-carta/money/rounding`), with **`"sideEffects": false`** set so unused re-exports still tree-shake. This curated boundary module is the _only_ acceptable barrel-like file; keep it flat (no nested re-export chains).
- **Across packages**, import only another package's declared `exports` — never reach into its internal files.
- **Enforcement:** the **Oxlint no-barrel rule** runs in `vp check`; **`dependency-cruiser` / `ts-arch`** boundary + `no-cycle` rules run in CI (the _Architectural integrity & coherence_ fitness-function tier). The wrong import fails CI, not review.

Rationale and rejected alternatives: **ADR-0070**. This is the boundary-rules category of the white paper's _Architectural integrity & coherence_.

---

## Lint ruleset — where it lives, what's on

**The ruleset lives in the `lint` block of the root `vite.config.ts`** — rules, categories, plugins, and ignore patterns. `vp lint` / `vp check` read Oxlint config from there and **not** from a root `.oxlintrc.json`. A dotless `oxlintrc.json` (or a rule set only in a file vp does not read) is silently unenforced — the config loads without error and the rule simply never fires, so keep the whole ruleset in `vite.config.ts`.

Enabled:

- **Categories.** `suspicious` and `perf` are **warn** — high-signal but with enough justified existing cases that a hard failure would block unrelated work; warnings do not fail `vp check`, so they are advisory until burned down. `correctness` is **not overridden** and keeps its inherited (advisory) severity — promoting it to a hard error is tracked below, not done.
- **Plugins.** `typescript`, `unicorn`, `oxc`. No `react`/`jsx-a11y`: the app is Svelte with no `.tsx`/`.jsx`, and Svelte a11y is svelte-check's job. `import` and `vitest` are held back — enabling them turns real findings in existing code into gate errors, so each is adopted behind its own cleanup pass.
- **Errors.** `oxc/no-barrel-file` is the one rule set to **error** — the barrel-file ban is structural, so it blocks rather than advises.
- **Off, on purpose.** `typescript/no-unsafe-type-assertion` only: reviewed `as` at typed parse/deserialize/branded-id seams is the intended tool, so repo-wide enforcement is low-signal noise. `eslint/no-await-in-loop` is **on** as a warning through the `perf` category — sequential D1/Queue batches are usually deliberate, but the count is a tenable backlog and a genuinely hot-path loop is worth surfacing, so it stays advisory rather than off.

The whole-repo pass currently reports **0 errors and ~820 warnings across ~1850 files**, and takes ~45 minutes on a 4-core runner. That runtime is why the gate lints only the affected packages on a pull request and pays the whole-repo pass on the merge and scheduled tiers — see [`build-performance.md`](build-performance.md).

A change to `vite.config.ts` is a global lint input: `tooling/affected-lint` re-lints the **whole repo** for it (the ruleset can move findings anywhere), so a ruleset edit pays the full type-aware pass in CI.

### Planned strictening (tracked)

Two tightenings are deferred, not rejected — each needs a cleanup pass before it can be a hard gate:

- **Promote `correctness` to a hard error.** It currently keeps its inherited (advisory) severity; forcing it to `error` turns the existing correctness findings (`typescript/unbound-method`, `eslint/no-unused-vars`, `eslint/preserve-caught-error`, …) into gate failures. Fix those findings, then set `categories.correctness: "error"`. Correctness is the category that most deserves to block, so this is the highest-value next step.
- **Enable `typescript/no-unsafe-type-assertion`.** Off today (~600 findings, mostly reviewed `as` at typed seams). Investigate whether a narrower form — an `overrides` entry scoping it to non-seam directories, or a codemod that replaces the mechanical cases — makes it a net win, then turn it on where it pays.

Adopting the `import` and `vitest` plugins is the same shape of work (they surface real findings in existing test code) and belongs on this list too.
