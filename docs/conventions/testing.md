# Testing conventions

**Status:** Framework decided (ADR-0041); layer details + CI gates filled in during Phase 0.

**Scope (single home for):** how Magna Carta is tested — the test layers and their tools, where test data comes from, and determinism rules.

**Authoritative context:** the white paper — _Synthetic data & fixtures_ (test data) and _Design system_ (visual regression) and _Development guidelines_ (tooling).

## Layers & tools

- **Unit + component (behavior)** — **Vite+ integrated testing** (the Vite+ toolchain's test runner, Vite-native). Svelte components test against the same SvelteKit pipeline with no extra build config: assert props, events, state, and **accessibility**. This is the standard place a component's _behavior_ is verified (visual-regression below catches _appearance_).
- **Integration** — Vite+ testing against **Miniflare** (local D1 + R2), exercising Workers/API and the domain write-paths.
- **End-to-end** — **Playwright**.
- **Visual regression** — **Playwright** screenshots over the **Storybook** component catalog, across every theme×mode, baselines generated in the pinned Playwright Docker image (Argos CI the named upgrade); catches cross-component drift (design-system enforcement, white paper _Design system_; ADR-0076).

A component is properly covered when it has: a **catalog entry** (definition/review), **behavior tests** (Vite+), and is under **visual-regression** — appearance _and_ behavior, not one or the other.

## Test data

- **Fixtures via domain write-paths only** — typed factories calling real service APIs; never raw SQL inserts (would bypass ledger/trust/conflicts invariants). See the white paper _Synthetic data & fixtures_.
- **Determinism:** single injectable seed, fixed clock, seeded IDs; `crypto.randomUUID` and wall-clock time banned in fixtures.
- The three fixture entry points: asserted **scenarios** (`trustOverdraftBlocked`, `conflictHit`, three-way reconciliation), **demo-firm bundle**, **load profile**.
- Fixtures **never run in production** (guarded).

## To detail (Phase 0)

- TDD expectations and the CI gate (what must pass to merge).
- Coverage targets and where they apply.
- Vite+ test config specifics (environment, when to use real-browser component testing vs. simulated DOM).
