# @magna-carta/record-transfer — CLAUDE.md

**Purpose.** The record transfer: bringing a firm's records in from the practice-management system it is leaving. Today it holds the run a transfer is recorded under, the files a run was given, the reader that turns a delimited-text file into numbered rows, the link from each source record to the record here that it became, and the first record kinds: the mapping rules and the loaders for Directory people and organizations, and for matters with their parties. The statement builders, the reader and the mapping rules are pure. The loaders are the only modules that commit, with the database and clock they are handed; nothing here holds a binding.

**White paper:** _LEAP migration_ — [`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
**Spec:** [`docs/specs/2026-11-10-record-transfer-framework-design.md`](../../docs/specs/2026-11-10-record-transfer-framework-design.md). (ADR-0021; `docs/decisions/pending/a-transferred-record-is-linked-to-its-source-in-one-table.md`; `docs/decisions/pending/a-transfers-staging-store-is-the-source-file-itself.md`.)

## Key files / entry points

- `src/source-record.ts` — the vocabulary: `assertSourceSystem` (a lower-case slug), `SourceRecordKey`, and `LINKABLE_LOCAL_TABLES`, the list of per-firm tables a link may name with the key column of each
- `src/transfer-run-statements.ts` — start, read, list, complete and abandon a run
- `src/source-record-link-statements.ts` — write a link, read the record a source record became, read where a record came from, and the two counts a run's report is built from
- `src/source-file.ts` — what a source file is: its kind and format slugs, `SOURCE_FILE_FORMATS` (the formats a reader exists for), the object key its bytes are kept under, `SourceFileRow`, and the two helpers that lay a row against a header and read its key
- `src/transfer-source-file-statements.ts` — register a file, read one, list a run's files, record the first read and record the release of the bytes
- `src/delimited-text-reader.ts` — `readDelimitedText`, the reader for comma-, tab-, semicolon- or pipe-separated text with a header row
- `src/directory-mapping.ts` — the mapping rules for people and organizations: `mapPersonRow`, `mapOrganizationRow`, `columnsMissingFrom` (the rules checked against a header) and `calendarDateFrom` (a date in a stated order)
- `src/directory-transfer.ts` — `transferPerson` and `transferOrganization`: read the link, and when there is none write the record and its link in one commit
- `src/matter-mapping.ts` — the mapping rules for matters: `mapMatterRow` and `matterColumnsMissingFrom`. The client and parties stay as source keys in the draft
- `src/matter-transfer.ts` — `transferMatter`: read the link, resolve the client and parties to live Directory records, and write the matter, its parties and its link in one commit

## Local conventions

- **A transfer reads the link before it writes.** `selectLinkedLocalRecordStatement` first: a row means the record already arrived and is left as it is, no row means create one and insert the link in the same batch. That read is what makes a transfer safe to run twice. A linked record is not overwritten from its file, because somebody may have corrected it since.
- **`insertSourceRecordLinkStatement` has no `ON CONFLICT` on purpose.** A conflict means a mapper skipped the read or two writers raced. Swallowing it would leave a second record created and unlinked.
- **A new kind of record is one line in `LINKABLE_LOCAL_TABLES`.** The link table has no foreign key on `local_table`/`local_id`, so that list is the only guard against a link that points nowhere. `test/schema-name-sync.test.ts` fails a line that names a table or key the schema lacks.
- **A source system is a slug, never a display name.** `leap`, not `LEAP`. The builders refuse anything else before the database is asked, and the tables carry the same rule as a CHECK.
- **`source_id` is stored verbatim and compared, never parsed.** A source system's key is whatever that system says it is.
- **The staging store is the file, and none of its content enters the database.** A source file is kept unchanged in object storage and re-read into the same numbered rows. Do not add a table of staged rows: an extract carries bank and identity numbers in columns nobody can name in advance, and a row copied into the database is those values in the clear.
- **A reader interprets nothing.** A value is the characters between two delimiters: not trimmed, not parsed, not treated as empty because it reads `NULL`. Meaning is the mapping rules' question.
- **A ragged row is reported, a broken file is refused.** `sourceFileRowFields` returns a fault for a row with the wrong number of values and the read carries on. `DelimitedTextError` is for a file that cannot be read as rows at all.
- **A fault's wording is a fixed sentence.** Nothing from a file appears in an error message, because messages are logged and file content is not.
- **No column name of a source system appears in the code.** Which column holds which part of a record is the operator's statement, passed in as mapping rules. A constant naming a LEAP column would make the module LEAP's, and would be a guess until a sample file says otherwise.
- **A rejection loses the row; a finding loses one value.** A row with no name produces no record. A malformed email, phone or date is left out of an otherwise good record and returned as a `MappingFinding` naming its column, never dropped silently.
- **A date's order is stated in the rules, never inferred from the values.** `03/04/2021` is two different days in two countries' exports.
- **A record is written by its owning package's compose function.** The loader never builds a Directory row itself: it takes `composePersonRecord` / `composeCreateOrganization` statements and adds the link, so a transferred record has the same history and audit rows as a typed one.
- **A record waits for the records it names.** A matter whose client or party has no live Directory record is not written; the outcome lists what is missing. Because a second run never updates, a record written without a reference would never get it back.
- **A transferred record announces nothing.** `composeTransferredMatter` returns no outbox messages, so no conflicts check or notification follows an arrival. Do not add one to a loader: telling the product about transferred records belongs to accepting a run.
- **A reference is a source key and is not trimmed.** `valueOf` trims a field; a column that holds another record's key is read exactly, because it must equal the key that record was linked under.
- **A new reader adds its format to `SOURCE_FILE_FORMATS`.** A file registered under a format nothing reads is refused before the database is asked.

## Invariants that apply here

- **Data access through the firm-scoped data-access layer** (golden rule 3). These builders take the firm's own database handle; nothing here chooses a firm.
- **Additive schema only.** `transfer_run` is referenced by `source_record_link`, so it carries no status vocabulary: `completed_at` and `abandoned_at` are the two endings, and a new ending is a new column.
- **Object keys are server-minted.** `transferSourceFileObjectKey` builds a key from the run and file identifiers. A file's own name is display text and never part of a key.
- **Erasure.** `source_record_link` is registered in `packages/data-access/src/pii-registry.ts` on `local_id`: a link to a Directory person or organization is that subject's identifier in the system the firm left.

## Dependencies & contracts

- Depends on `@magna-carta/data-access` for the `SqlDatabase` / `SqlStatement` surface, on `@magna-carta/identifiers` for its identifier types, on `@magna-carta/directory` for the compose functions and input types a transferred person or organization is written with, on `@magna-carta/matters` for `composeTransferredMatter`, and on `@magna-carta/civil-time` to turn a file's day into a stored instant.
- Nothing in the product calls it yet. The upload route and the pass that reads a file and drives the mapping rules and the loader are its first callers.

## Gotchas

- **A merged Directory record keeps its links.** After two people are merged, the links of the archived one still name it. A reader that wants the surviving record follows `merged_into_id`; the links are not repointed, so the history of what arrived as what stays true.
- **`rowNumber` and `lineNumber` differ.** The row number counts data rows from 1 and is what a link or a rejection cites. The line number is where the row starts in the file, and runs ahead as soon as a quoted value holds a line break.
- **A line with nothing on it is skipped; a line of delimiters is a row.** `""` alone on a line is also a row, of one empty value.
- **Ending a run that has already ended changes no row, and that is an answer, not a fault.** Both ending statements repeat "still open" in their WHERE and are marked as unguarded writes: read `meta.changes` and report "already ended". A run's links stand however it ended.
