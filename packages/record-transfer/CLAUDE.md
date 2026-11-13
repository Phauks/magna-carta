# @magna-carta/record-transfer — CLAUDE.md

**Purpose.** The record transfer: bringing a firm's records in from the practice-management system it is leaving. Today it holds the foundation every later part stands on: the run a transfer is recorded under, the files a run was given, the reader that turns a delimited-text file into numbered rows, and the link from each source record to the record here that it became. Pure statement builders, a pure reader, and the vocabulary they validate against. No I/O of its own, no clock, no binding.

**White paper:** _LEAP migration_ — [`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
**Spec:** [`docs/specs/2026-11-10-record-transfer-framework-design.md`](../../docs/specs/2026-11-10-record-transfer-framework-design.md). (ADR-0021; `docs/decisions/pending/a-transferred-record-is-linked-to-its-source-in-one-table.md`; `docs/decisions/pending/a-transfers-staging-store-is-the-source-file-itself.md`.)

## Key files / entry points

- `src/source-record.ts` — the vocabulary: `assertSourceSystem` (a lower-case slug), `SourceRecordKey`, and `LINKABLE_LOCAL_TABLES`, the list of per-firm tables a link may name with the key column of each
- `src/transfer-run-statements.ts` — start, read, list, complete and abandon a run
- `src/source-record-link-statements.ts` — write a link, read the record a source record became, read where a record came from, and the two counts a run's report is built from
- `src/source-file.ts` — what a source file is: its kind and format slugs, `SOURCE_FILE_FORMATS` (the formats a reader exists for), the object key its bytes are kept under, `SourceFileRow`, and the two helpers that lay a row against a header and read its key
- `src/transfer-source-file-statements.ts` — register a file, read one, list a run's files, record the first read and record the release of the bytes
- `src/delimited-text-reader.ts` — `readDelimitedText`, the reader for comma-, tab-, semicolon- or pipe-separated text with a header row

## Local conventions

- **A transfer reads the link before it writes.** `selectLinkedLocalRecordStatement` first: a row means update that record, no row means create one and insert the link in the same batch. That read is what makes a transfer safe to run twice.
- **`insertSourceRecordLinkStatement` has no `ON CONFLICT` on purpose.** A conflict means a mapper skipped the read or two writers raced. Swallowing it would leave a second record created and unlinked.
- **A new kind of record is one line in `LINKABLE_LOCAL_TABLES`.** The link table has no foreign key on `local_table`/`local_id`, so that list is the only guard against a link that points nowhere. `test/schema-name-sync.test.ts` fails a line that names a table or key the schema lacks.
- **A source system is a slug, never a display name.** `leap`, not `LEAP`. The builders refuse anything else before the database is asked, and the tables carry the same rule as a CHECK.
- **`source_id` is stored verbatim and compared, never parsed.** A source system's key is whatever that system says it is.
- **The staging store is the file, and none of its content enters the database.** A source file is kept unchanged in object storage and re-read into the same numbered rows. Do not add a table of staged rows: an extract carries bank and identity numbers in columns nobody can name in advance, and a row copied into the database is those values in the clear.
- **A reader interprets nothing.** A value is the characters between two delimiters: not trimmed, not parsed, not treated as empty because it reads `NULL`. Meaning is the mapping rules' question.
- **A ragged row is reported, a broken file is refused.** `sourceFileRowFields` returns a fault for a row with the wrong number of values and the read carries on. `DelimitedTextError` is for a file that cannot be read as rows at all.
- **A fault's wording is a fixed sentence.** Nothing from a file appears in an error message, because messages are logged and file content is not.
- **A new reader adds its format to `SOURCE_FILE_FORMATS`.** A file registered under a format nothing reads is refused before the database is asked.

## Invariants that apply here

- **Data access through the firm-scoped data-access layer** (golden rule 3). These builders take the firm's own database handle; nothing here chooses a firm.
- **Additive schema only.** `transfer_run` is referenced by `source_record_link`, so it carries no status vocabulary: `completed_at` and `abandoned_at` are the two endings, and a new ending is a new column.
- **Object keys are server-minted.** `transferSourceFileObjectKey` builds a key from the run and file identifiers. A file's own name is display text and never part of a key.
- **Erasure.** `source_record_link` is registered in `packages/data-access/src/pii-registry.ts` on `local_id`: a link to a Directory person or organization is that subject's identifier in the system the firm left.

## Dependencies & contracts

- Depends on `@magna-carta/data-access` for the `SqlDatabase` / `SqlStatement` surface and on `@magna-carta/identifiers` for `TransferRunId`.
- Nothing calls it yet. The upload route, the mapping rules and the loader described in the spec are its first callers.

## Gotchas

- **A merged Directory record keeps its links.** After two people are merged, the links of the archived one still name it. A reader that wants the surviving record follows `merged_into_id`; the links are not repointed, so the history of what arrived as what stays true.
- **`rowNumber` and `lineNumber` differ.** The row number counts data rows from 1 and is what a link or a rejection cites. The line number is where the row starts in the file, and runs ahead as soon as a quoted value holds a line break.
- **A line with nothing on it is skipped; a line of delimiters is a row.** `""` alone on a line is also a row, of one empty value.
- **Ending a run that has already ended changes no row, and that is an answer, not a fault.** Both ending statements repeat "still open" in their WHERE and are marked as unguarded writes: read `meta.changes` and report "already ended". A run's links stand however it ended.
