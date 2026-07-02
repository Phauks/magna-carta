# Finding: `vp check` type-checking is not enforced end-to-end (a performance-induced coverage gap)

**Date:** 2026-06-30. **Status:** open finding; recommended action is the incremental type-check gate
(see [`build-performance.md`](../conventions/build-performance.md), _Type-checking and static
analysis_, and the project-references rollout spec).

## Symptom

`main` carries **real type errors that the `pnpm check` gate does not surface.** The first found:

```
packages/file-manager/src/queries.ts(177,5): error TS2322:
  Type '{ …; scanVerdict: "unscanned" | "clean" | "infected" | null; … } | null'
  is not assignable to type 'CleanVersion | null'.
```

It is not touched by any recent branch — it is pre-existing on `main`. The full-graph `tsc -b`
surfaced **16 such errors** (concentrated in `apps/worker`, `packages/pdf`, `packages/file-manager`;
inventory in the rollout spec's _Landing status_).

## Investigation

| Check | Result |
|---|---|
| `vp check --no-fmt packages/file-manager/src/queries.ts` (scoped) | **Catches it** — reports `typescript(TS2322)`, exits 1, in seconds |
| `tsc --noEmit -p packages/file-manager/tsconfig.json` (package) | Catches it in ~10s (1 error) — confirms it is **real**, not composite/emit-induced |
| `tsc -b tsconfig.build.json` (full graph) | 16 errors, ~46s |
| **`vp check --no-fmt` (whole repo)** | **Timed out at 10 minutes with no output — never completed** |

`apps/worker`'s type-check alone exceeded 3 minutes.

## Root cause

**Not** a linter-capability gap: `vp check`'s `typeCheck` (tsgolint) *does* catch these errors when it
runs. The gap is **performance**. The whole-repo type-check has no incrementality, so it scales with
total code and, at the current size, does not complete in a practical time. A gate that cannot be run
to completion is not enforced — so latent type errors accumulate on `main` unnoticed, and the green
`pnpm check` that contributors see locally (when they scope it, or skip the slow type pass) gives
**false confidence**.

## Why it matters

The type-check is a correctness gate. If it silently isn't running to completion, real regressions
merge. The 16 already on `main` are the evidence. This will worsen as the monorepo grows.

## Recommended action

1. **Make the full type-check practical → then enforce it.** The project-references incremental
   type-check (`vp run typecheck` = `tsc -b`, already landed non-gating) brings the full check to ~46s
   cold and seconds warm. Once the 16 latent errors are fixed, wire it into `pnpm check` so the gate
   both *completes* and *fails on real errors*. This is the fix — the gap closes because the check
   becomes fast enough to actually run.
2. **Scope the local inner loop** to changed files/packages (`vp check <paths>`, `tsc -b <pkg>`) so
   contributors get a fast, complete check rather than skipping a slow one.
3. **Fix the 16 surfaced errors** (tracked fix-forward; touches active branches + one domain call).
4. **Confirm CI runs the type-check to completion and gates on it** — the reason these slipped is
   worth verifying at the pipeline level, not only locally.

## Note on `vp check`'s type pass vs. the incremental gate

`vp check`'s `typeCheck: true` builds a whole-program type model for its type-aware pass; that is the
slow part. Once `tsc -b` is the authoritative type-check, consider whether `vp check` should keep its
own `typeCheck` (a double type-program build) or drop it in favour of the incremental gate — after
confirming type-aware **lint** coverage (e.g. floating-promise rules) is preserved.
