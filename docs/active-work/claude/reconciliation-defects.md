# claude/reconciliation-defects

**Scope.** Three verified defects in the trust package's reconciliation and statement-import reads.
No schema change, no new capability, no UI. (1) The statement-import preview fingerprint's canonical
text is ambiguous across field boundaries, so a shift between two fields survives the
preview-to-confirm check. (2) The unmatched-statement-lines read has no truncation probe, unlike the
outstanding-item read beside it — safe today only because two unrelated constants happen to sit in
the right order. (3) "Unmatched statement line" is defined twice, once in SQL for the proof and once
as a TypeScript filter for the matching surface; one becomes a caller of the other.

**Files expected to touch**

- `packages/trust/src/statement-import.ts` — `fingerprintOf`: length-prefixed fields
- `packages/trust/src/statements.ts` — the unmatched-lines select asks one row past the cap
- `packages/trust/src/three-way-proof.ts` — the new probe, its refusal, and the shared unmatched-line
  read both surfaces call
- `packages/trust/src/matching.ts` — `readTrustMatchSuggestions` calls that read instead of
  re-deriving the list
- `packages/trust/src/trust-validation.ts` — the new refusal code
- `packages/trust/test/reconciliation.test.ts`, `packages/trust/test/statement-import.test.ts`
- `apps/worker/src/routes/trust-reconciliation.ts` — the refusal-to-problem mapping
- `apps/worker/src/contracts/problem-types.ts` + `apps/worker/test/contracts/problem.test.ts` — the
  problem-type registry and its inventory
- `packages/trust/CLAUDE.md` — the invariant text for the second probe
- `changelog.d/` — fragment only

**Not touched.** No migration, no `packages/database` schema, no ledger, no billing, no UI package.
Nothing edits `CLAUDE.md`, `STATUS.md`, `ROADMAP.md`, the white paper, `CHANGELOG.md`, the
Decision-Log register, or `docs/conventions/`.

**Overlap watch.** `apps/worker/src/contracts/problem-types.ts` and its inventory test are the shared
files — a one-line addition to each, appended beside the existing trust entries. Everything else is
inside `packages/trust/`.
