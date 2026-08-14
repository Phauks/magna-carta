---
category: Changed
audience: internal
---

Custodian's number draw now runs on `@magna-carta/sequence-numbering` instead of its own copy of the
idiom, leaving one home for how a sequence number is allocated.

Custodian grew its counter and allocation statements before the shared package was extracted out of
matters, so the same read-render-commit — ensure the counter row, increment it guarded on the
observed value, and claim the drawn value in an allocation row whose composite primary key is the
actual backstop — existed twice. `packages/custodian/src/numbering/counter-statements.ts` is now the
same thin shim `@magna-carta/matters` uses: it binds `custody_number_counter`,
`custody_number_allocation`, and the `packet_id` owner column to the shared builders and keeps the
`CustodyPacketId` typing on the allocation. Every export it had, it still has.

**Behavioural identity was the bar, and the SQL is unchanged.** The shared builders emit the same
statements for these table names, character for character, so a custody number renders exactly as it
did — the shape is printed on physical labels and read out over the phone, and a format change would
not be a refactor. The one difference in reachable behaviour is a widening that cannot fire:
`isNumberAllocationConflict` also recognises the append-only refusal that an allocation table with a
no-overwrite trigger raises ahead of its primary key, and `custody_number_allocation` has no such
trigger. Custodian's existing suite is the proof — the concurrent-draw test still walks three
simultaneous draws out to `CUS-00001`/`00002`/`00003`, the allocation ledger still records one row per
drawn value and none for a manual number, and the retry still steps past a manual number the counter
would have rendered. A new case pins what the shared, table-parameterised predicate must not lose: a
collision on `matter_number_allocation` is not a custody draw race and is never retried as one.

**The retry loop deliberately stays in `packet-service.ts`.** `drawWithBoundedRetry` cannot express
two things custodian's loop does: it gives up as a named `CustodyValidationError`
(`custody-number-exhausted`) that the route maps to a problem type rather than as a bare `Error`, and
it retries a manual-number collision that consumed no counter value and therefore has no observed
draw to advance past. Matters keeps its own loop for the same kind of reason. The statement builders
are what was duplicated and what is now shared; a loop growing an option per consumer's error
vocabulary would be shared in name only.
