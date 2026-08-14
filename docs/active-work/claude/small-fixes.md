# claude/small-fixes

**Scope.** Three small, independent defects, one commit each, one pull request.

1. **Calendar source-fitness test margin.** `packages/calendar/test/source-fitness.test.ts` failed
   with a 5 s timeout on an unrelated branch under CPU contention. The file re-migrates a fresh
   in-memory per-firm database on every statement composition, so a pure predicate-composition pass
   costs seconds instead of milliseconds.
2. **`@magna-carta/sequence-numbering` retry contract.** `drawWithBoundedRetry` throws a bare
   `Error` and cannot express a caller's error type, so custodian and matters both keep private
   copies of the loop. Widen the contract, adopt it in both, delete the duplication.
3. **Discovery's record-custodian label.** Owner answered flag D1 — the label reads
   "Custodian of Record". Vocabulary only (OpenAPI descriptions, problem titles, notification copy,
   `docs/user/`); no Svelte surfaces.

**Files expected to be touched.**

- `packages/calendar/test/source-fitness.test.ts`
- `packages/sequence-numbering/src/**`, `packages/sequence-numbering/test/**`
- `packages/custodian/src/numbering/packet-service.ts`, `packages/matters/src/**`
- discovery's record-custodian strings: `packages/discovery/src/**`,
  `apps/worker/src/routes/discovery*.ts`, `apps/worker/openapi/openapi.json`,
  `packages/api-client/src/**` (both generated), `docs/user/**`
- `changelog.d/small-fixes-*.md`
