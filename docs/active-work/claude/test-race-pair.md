# claude/test-race-pair

**Scope:** Two full-suite test-reliability defects plus one metadata repair.

1. `apps/worker/test/search-reextraction-sweep.test.ts` — verdict mismatches under
   full-suite load (the live search-index queue consumer races the test's simulated
   verdicts and its `queued` assertions).
2. `apps/worker/test/document-assembly-protected-binding.test.ts` — decrypt-audit
   count off by one under full-suite load (the route submit enqueues a real
   document-assembly message whose live consumer races the test's direct consume).
3. `packages/database/drizzle/per-firm/meta/0048_snapshot.json` — repair the
   `prevId` lineage pointer to 0047's actual id (metadata only, no renumbering).

**Files expected to touch:**

- `apps/worker/test/search-reextraction-sweep.test.ts`
- `apps/worker/test/document-assembly-protected-binding.test.ts`
- `packages/database/drizzle/per-firm/meta/0048_snapshot.json`
- `changelog.d/test-race-pair.md`

No product code changes expected unless the races prove to live in the verdict
state machines rather than the tests.
