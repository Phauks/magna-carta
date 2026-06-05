# TypeScript conventions

**Status:** Stub — to be written when the repo scaffold lands (Phase 0).

**Scope (single home for):** TypeScript-specific style, tooling, and idioms. Shared cross-language principles live in [`code-style.md`](code-style.md); don't repeat them here.

**Authoritative context:** the [white paper](../Magna-Carta-White-Paper.md) — _Delivery model_ (Workers/Hono, code-as-contract, Svelte 5 SPA). API-contract specifics live in [`api.md`](api.md); UI specifics in [`ui-design.md`](ui-design.md).

**To document:**

- **Oxlint** (`vp lint`) + **Oxfmt** (`vp fmt`; Prettier interim until Oxfmt is GA), with `vp check` running format + lint + **tsgolint** type-check in one pass: rules enforced, how to run, the CI gate.
- **Current scaffold reality (Phase 0):** `vp check` runs **format + lint only** — tsgolint type-check is not yet enabled (it needs `lint.options.typeCheck` in the root `vite.config.ts`, and tsgolint does not parse `.svelte` files regardless). The quality gate runs through the root `check` package script (`pnpm check` / `pnpm run check`), which is `vp check && pnpm --filter @magna-carta/web check`; the second command is `svelte-check`, the type-checker for the SvelteKit app's `.ts` and `.svelte` source. CI must invoke `pnpm check` (or `vp check` followed by each package's `check` script), not bare `vp check`, until tsgolint type-check is enabled monorepo-wide. Wiring tsgolint into `vp check` and per-package type-check tasks is tracked for the worker slice (E3).
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
