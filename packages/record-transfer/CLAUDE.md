# @magna-carta/record-transfer — CLAUDE.md

**Purpose.** The record transfer: bringing a firm's records in from the practice-management system it is leaving. Today it holds the foundation every later part stands on, which is the run a transfer is recorded under and the link from each source record to the record here that it became. Pure statement builders and the vocabulary they validate against. No I/O of its own, no clock, no binding.

**White paper:** _LEAP migration_ — [`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
**Spec:** [`docs/specs/2026-11-10-record-transfer-framework-design.md`](../../docs/specs/2026-11-10-record-transfer-framework-design.md). (ADR-0021; `docs/decisions/pending/a-transferred-record-is-linked-to-its-source-in-one-table.md`.)

## Key files / entry points

- `src/source-record.ts` — the vocabulary: `assertSourceSystem` (a lower-case slug), `SourceRecordKey`, and `LINKABLE_LOCAL_TABLES`, the list of per-firm tables a link may name with the key column of each
- `src/transfer-run-statements.ts` — start, read, list, complete and abandon a run
- `src/source-record-link-statements.ts` — write a link, read the record a source record became, read where a record came from, and the two counts a run's report is built from

## Local conventions

- **A transfer reads the link before it writes.** `selectLinkedLocalRecordStatement` first: a row means update that record, no row means create one and insert the link in the same batch. That read is what makes a transfer safe to run twice.
- **`insertSourceRecordLinkStatement` has no `ON CONFLICT` on purpose.** A conflict means a mapper skipped the read or two writers raced. Swallowing it would leave a second record created and unlinked.
- **A new kind of record is one line in `LINKABLE_LOCAL_TABLES`.** The link table has no foreign key on `local_table`/`local_id`, so that list is the only guard against a link that points nowhere. `test/schema-name-sync.test.ts` fails a line that names a table or key the schema lacks.
- **A source system is a slug, never a display name.** `leap`, not `LEAP`. The builders refuse anything else before the database is asked, and the tables carry the same rule as a CHECK.
- **`source_id` is stored verbatim and compared, never parsed.** A source system's key is whatever that system says it is.

## Invariants that apply here

- **Data access through the firm-scoped data-access layer** (golden rule 3). These builders take the firm's own database handle; nothing here chooses a firm.
- **Additive schema only.** `transfer_run` is referenced by `source_record_link`, so it carries no status vocabulary: `completed_at` and `abandoned_at` are the two endings, and a new ending is a new column.
- **Erasure.** `source_record_link` is registered in `packages/data-access/src/pii-registry.ts` on `local_id`: a link to a Directory person or organization is that subject's identifier in the system the firm left.

## Dependencies & contracts

- Depends on `@magna-carta/data-access` for the `SqlDatabase` / `SqlStatement` surface and on `@magna-carta/identifiers` for `TransferRunId`.
- Nothing calls it yet. The staging store, the mapping rules and the loader described in the spec are its first callers.

## Gotchas

- **A merged Directory record keeps its links.** After two people are merged, the links of the archived one still name it. A reader that wants the surviving record follows `merged_into_id`; the links are not repointed, so the history of what arrived as what stays true.
- **Ending a run that has already ended changes no row, and that is an answer, not a fault.** Both ending statements repeat "still open" in their WHERE and are marked as unguarded writes: read `meta.changes` and report "already ended". A run's links stand however it ended.
