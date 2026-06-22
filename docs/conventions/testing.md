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

## Owner manual verification checklist (UI slices)

Every slice that ships UI also ships a **manual verification checklist** — a definition-of-done deliverable, owner-directed (2026-06-11, slice 1·1 design cycle). It is a short document of concrete, clickable walkthrough steps the owner performs to visually confirm the feature behaves as intended (e.g. "create a year-scoped numbering scheme; confirm the live preview renders `2026-0001`; create a consultation; confirm it has no number and appears in your Consultations folder"). It complements — never replaces — the automated layers above: automated tests prove the code's behavior; the checklist gives the owner a structured visual pass over the product's behavior. Checklists live with the slice's docs in [`docs/specs/`](../specs/) (one per slice, written during the build, kept current with UI changes).

## The 7-angle adversarial review (run during build / before a branch merges)

Every package or vertical slice gets an **adversarial review with empirical verifiers** once its tasks land and before it merges — this is what `STATUS.md`'s **Built** column means (implemented _and_ reviewed; review is not a separate column). It is not a prose read-through: each finding is **proven by a runnable verifier** (a focused test, a `grep`/source scan, a fault-injection, a migration apply) — evidence, not assertion. The pass attacks the change from seven angles; each slice instantiates them for its own domain (the ledger slice's "batch-atomicity edges / append-only source scan", the load-profile slice's "generator realism / snapshot-identity holes" are domain instances of the same frame):

1. **Correctness & edge cases** — boundary inputs and partial-failure injection; the unhappy paths, not just the happy one.
2. **Concurrency, ordering & idempotency** — races, retries, at-least-once redelivery, double-apply windows (queue consumers, effect batches, outbox).
3. **Determinism & reproducibility** — behavior under clock / locale / seed / platform variation; no wall-clock or unseeded randomness where reproducibility is required.
4. **Boundary & public surface** — the exports map / no-barrel discipline, a minimal public API, and type-consistency of shared names across the modules that define and consume them.
5. **Invariant & constraint coverage** — domain invariants and DB CHECK/PK/index coverage matched against the spec; fitness functions that assert the real rule, not a mock.
6. **Static fitness scans** — source-scan guards: append-only tables, forbidden patterns, `lint:process-refs` (golden rule 13), full-name discipline (golden rule 12), purity/no-cross-firm.
7. **Security & tenancy isolation** — privilege/confidentiality (redaction, no privileged content in logs/errors), firm-scoping (no query or handle crosses firms), and secret handling.

Run it as a fan-out of independent reviewers (one per angle, or grouped), each returning findings with a `file:line` and the verifier that proves it; fix findings and update docs in the same pass. A finding without a runnable verifier is a hypothesis, not a result.

## To detail (Phase 0)

- TDD expectations and the CI gate (what must pass to merge).
- Coverage targets and where they apply.
- Vite+ test config specifics (environment, when to use real-browser component testing vs. simulated DOM).
