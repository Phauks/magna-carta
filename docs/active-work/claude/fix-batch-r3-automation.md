# claude/fix-batch-r3-automation

**Scope.** Fix batch R3: every finding in
[`docs/reviews/2026-08-06-campaign-2-automation.md`](../reviews/2026-08-06-campaign-2-automation.md)
— 3 high, 7 medium, 6 low — across the document-assembly expression language, the email-filing DKIM
verifier and auto-file rules, composite text extraction, and their worker adapters.

**Status.** Complete; open as a pull request, not merged.

## Files touched

- `packages/document-assembly/src/expression/evaluate.ts` — the shared calendar-range guard, the date
  ordering refusal
- `packages/document-assembly/src/assemble.ts` — a rendering failure records an absence rather than an
  empty string
- `packages/document-assembly/src/custom-field-bindings.ts` — a stored non-calendar date becomes text
- `packages/document-assembly/test/expression-evaluate.test.ts`
- `packages/email-filing/src/dkim.ts` — the From requirement, the signature/lookup bounds, body
  coverage, key-record checks
- `packages/email-filing/src/capture.ts`, `src/auto-file-rules.ts`, `src/index.ts`
- `packages/email-filing/test/dkim.test.ts`, `test/auto-file-rules.test.ts`
- `packages/data-access/src/email-auto-file-statements.ts` — the window-limit contract, documented
- `crates/email-core/src/eml.rs` — the duplicate-From instance, pinned by test
- `packages/file-manager/src/queries.ts` — the candidate keyset cursor, the version's size
- `apps/worker/src/search/` — `reextraction-sweep.ts`, `index-coordinator.ts`, `index-types.ts`,
  `enqueue-index.ts`, `engine-generation.ts` (new), `text-extraction.ts`
- `packages/search/src/extraction.ts` — one page per index; the provenance forward seam
- `apps/worker/src/routes/email-add-in.ts` — over-fetch before the wall filter
- `apps/worker/src/emails/capture-consumer.ts`, `packages/directory/src/contact-email.ts` — the
  batched address lookup
- `packages/fixtures/src/load-profile/document-automation-*.ts` — the expression/protected probe

## Overlap to watch

- `packages/search/` moved in the discovery-core merge; this branch is based on that tree.
- No migration: the journal head is untouched (idx 38). The re-attempt bound lives in Durable Object
  storage and the DKIM body-coverage fact rides the in-memory verification, so neither needs a column.
