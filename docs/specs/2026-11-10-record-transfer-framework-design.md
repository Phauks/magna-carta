# Record transfer framework (LEAP first) — design

**Date:** 2026-11-10 · **Status:** Accepted (framework, first and second slices); later slices proposed · **Area:** Platform / Core domain
**Builds on:** the white paper's _LEAP migration_ topic and ADR-0021 (migration deferred, legacy identifiers required, trust reconciliation as the cutover gate)
**Decisions:** `docs/decisions/pending/a-transferred-record-is-linked-to-its-source-in-one-table.md`, `docs/decisions/pending/a-firm-chooses-per-matter-whether-transferred-money-is-view-only.md`, `docs/decisions/pending/a-transfers-staging-store-is-the-source-file-itself.md`
**Owner rulings:** 2026-11-10, in the project thread that produced this document, listed in section 2

## 1. Scope

A firm arriving at Magna Carta brings its records from the practice-management system it is leaving. The first such system, and the firm's own, is LEAP. This document designs the framework that carries those records in: what the parts are, what each depends on, what order they are built in, and how a transfer is proved correct before the firm relies on it.

It is a framework and not a one-off script for three reasons. The transfer has to be rehearsed many times before it is run for real, so it must be repeatable. Every record it creates must stay traceable to the record it was, for as long as it exists. And the second firm to arrive will come from somewhere else.

**Out of scope here:** the field-by-field mapping of each record kind (each gets its own slice and its own section when built), the operator's screens, and any export of a firm's data _out_ of Magna Carta, which section 9 argues should exist and is its own design.

## 2. What the owner ruled

1. **Assume a vendor extract.** LEAP is expected to hand over the firm's data. The framework must not depend on the form that takes.
2. **No contact with LEAP yet.** Nothing in the design may wait on an answer from LEAP.
3. **Sample files will be uploaded from a computer** when convenient. They refine the readers and mappings; they do not block the framework.
4. **Learn from LEAP's published API, then build.** The reference is public and was read in full on 2026-11-10.
5. **The firm decides, matter by matter, whether a matter's earlier money is view-only** (2026-11-12). Section 6 sets out what that choice is and what the author added to make it buildable.

Everything else in this document is the author's recommendation.

## 3. What is known about the source

LEAP publishes its Developer API Gateway reference at `https://developer.leap.build/api-reference` (version 1.3.0, released 2 November 2026 by its own changelog; about 350 endpoints and 730 data models). Calling the API needs an approved application and a user's token. Reading the reference needs nothing, and it describes the same data an extract will carry. A dated copy of the reference is kept with the project's working files, outside this repository, because it is LEAP's documentation.

What it establishes, with LEAP's own field names:

- **Keys.** Every record has a GUID (`matterId`, `cardId`, `personId`, `documentId`, `FeeId`). A matter also has a display `fileNumber`. The GUID is the identifier a link stores; the file number becomes the matter number.
- **Soft deletion and row versions.** Records carry `deleteCode` or `Deleted` with `DeletedDate`, and a `rowVersion`. An extract will contain deleted rows that must be filtered, and a later run can carry only what changed.
- **Matters.** `firstdesc`, `seconddesc`, `customdesc`, `matterstatus`, `iscurrent`, `isarchived`, `instructiondate`, `completiondate`, an archive number, box number and destruction date, and four staff roles (responsible, acting, assisting, credit).
- **Matter details are generic tables.** A matter holds `definableTables`, each a `definableTableId`, an `order`, and `fields` of `fieldId` and `value`. A schema service publishes each matter type's tables and every field's name, data type and format.
- **Cards and people are separate.** A card is one of People, Company, Trust, Government or Business. It holds `persons`, addresses, phone numbers, a bank account, beneficiaries and trustees. One person can sit on several cards. A People card with two persons is a joint card.
- **Parties.** A card is attached to a matter through a card table (`tableId`, `order`, `default`, `reference`); the table names the role.
- **Documents.** A record has `name`, `fileName`, `type`, `createDate`, `lastModified`, `createdBy`, `toFrom`, a version list, attachments and an `internetMessageId` on emails. Folders are a tree per matter. File bytes are fetched separately through a short-lived address.
- **Time and fees.** `SecondsElapsed`, `RatePerHour`, `FeeUnits`, `TotalExTax`, `TotalTax`, `BillingMode`, `WorkDoneByStaffId`, `InvoiceId`. The rate charged is on each entry.
- **Trust.** Ledger lines carry `TransactionDate`, `EntryDate`, `TransactionNumber`, `AmountDeposit`, `AmountWithdrawal`, `Reconciled`, and separate header and item GUIDs, so one receipt can be split across matters.
- **Money is floating point** throughout (about 370 amount fields typed `double`).
- **LEAP's own inbound path** for another system's money (`conversions/trusttransactionsviewonly`, `conversions/officehistory`) loads it as view-only history with an `ImportedFrom` field, apart from the live ledger.

A vendor extract will probably name its columns differently from the API. The entities, keys and relationships are the same data and should match. The readers in section 4 are where any difference is absorbed.

## 4. The seven parts

| Part                  | What it does                                                                                                                                                   | Depends on the source's file format |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1. Readers            | One per kind of source file (a table of a database extract, a CSV report, a folder of documents). Each turns its input into staged rows and interprets nothing | Yes                                 |
| 2. Staging store      | Keeps every source file unchanged in the firm's object storage, apart from the firm's live data. A row is named by its file and its number in it (section 11)  | No                                  |
| 3. Mapping rules      | One set per record kind, plus lookup lists the operator edits: matter types, party roles, staff                                                                | Field names only                    |
| 4. Source-record link | Remembers which source record became which record here. Makes every run repeatable and every record traceable                                                  | No                                  |
| 5. Loader             | Writes mapped records through the firm-scoped data-access layer, in dependency order                                                                           | No                                  |
| 6. Rehearsal report   | After each run: counts in and out, every rejected row with its reason, money totals beside the source's own                                                    | No                                  |
| 7. Trust gate         | Refuses cutover unless every trust balance equals the source's to the cent                                                                                     | No                                  |

**Dependency order for the loader:** staff, Directory people and organizations, matters, parties, matter details, documents and emails, time and costs, invoices, trust.

**Rehearsal.** A transfer is run into a throwaway copy of the firm as many times as it takes for the report to come back clean. The live firm is written once, by the run that was rehearsed, from an extract taken after the source system is frozen.

## 5. The first slice: runs and links

Built with this document. Two per-firm tables and the package `@magna-carta/record-transfer`.

**`transfer_run`** — one run of a transfer: `id`, `source_system` (a lower-case slug, `leap`), `label`, `started_by`, `started_at`, `completed_at`, `abandoned_at`. It has no status column. The two timestamps are the two ways a run ends and at most one is set. The link table references this one, and a table something references cannot have a CHECK widened later, so a new ending is a new column.

**`source_record_link`** — one row per source record per kind of record it became: `source_system`, `source_kind`, `source_id`, `local_table`, `local_id`, `transfer_run_id`, `created_at`. The primary key is the first four columns. An index on `(local_table, local_id)` answers "where did this record come from".

Why one table and not a column on each entity:

- A source record can become more than one record here (a matter and its trust ledger), which a column on either cannot say.
- Several source records can become one (two cards for the same person), which a single column cannot hold.
- A column on every entity is a migration on every table; this is one migration for all of them, including tables not yet written.
- An integration that keeps an outside system's key for a record needs the same shape.

`local_table` and `local_id` carry no foreign key, because a row may name any table. The tables a link may name are listed in `LINKABLE_LOCAL_TABLES` with the key column of each. A write refuses any other name, and a test fails a line that names a table or key the schema does not have. The list starts at `directory_person`, `directory_organization` and `matter` and grows by one line per record kind.

**The rule every mapper follows:** read the link first. A row means update the record it names. No row means create the record and insert the link in the same batch. The insert carries no conflict clause, so a second record for one source record fails loudly.

**Merged Directory records keep their links.** After a merge the archived record's links still name it, and a reader follows `merged_into_id` to the survivor. Links are not repointed, so what arrived as what stays true.

**Erasure.** `source_record_link` is in the personal-data registry on `local_id`: a link to a person is that person's identifier in the system the firm left, and it goes when they do.

## 6. Money

The owner ruled on 2026-11-12 that a firm decides, for each matter, when importing, whether that matter's earlier money is view-only. The choice and its two answers are the ruling. The default, the point at which the choice locks, and the rules both answers share are the author's recommendation.

**The choice.** Each matter in a transfer carries a money handling of one of two values, set by the operator before the matter's money is loaded.

- **View-only history.** The matter's trust and office transactions from the source are kept as dated, read-only records beside the live ledger, and an opening balance is posted to the ledger at cutover. Nothing here can edit, reverse or re-bill them. This is the pattern LEAP itself uses for firms arriving from elsewhere.
- **Live.** The matter's transactions are written into the live ledger as entries, dated as the source dated them and marked as transferred, so they can be worked on here as any entry can: an unbilled time entry billed, an open invoice paid, a trust line reversed by a correcting entry.

**What the author recommends around it.**

- **The default is view-only.** A firm that makes no choice gets the safe answer for every matter, and a firm-wide default the operator can set covers the common case of "all open matters live, all closed matters view-only" without a decision per matter.
- **Live entries are written, not replayed.** The live posting rules were written for entries made here (approval, authority, rate lookup) and would reject or reinterpret history. A live matter's entries are inserted as the source recorded them, through a transfer-only path that keeps the ledger's structural rules (balanced, append-only, never negative in trust) and skips the rules about how an entry is made.
- **A live matter that fails the structural rules falls back, loudly.** If a matter's history cannot be written as a valid ledger (a trust balance that went negative in the source, for instance), the rehearsal report names the matter and the reason, and the operator either fixes the cause or sets the matter to view-only. It is never switched silently.
- **The choice locks at cutover.** It can be changed freely across rehearsals. Once the live firm is written, a view-only matter stays view-only and a live matter stays live, because converting either afterwards would rewrite a ledger people have since posted to.
- **One rounding rule.** Floating-point amounts become integer minor units by rounding half away from zero. Each matter's converted total is compared with the source's own total, and a difference is reported, never absorbed.
- **The gate is the same for both.** Cutover is refused unless every matter's trust balance equals the source's balance and the total equals the bank. For a view-only matter the history must also sum to its opening balance; for a live matter the ledger's own running balance is the figure compared.
- **Rates.** A historical time entry keeps the rate the source charged. It is not re-rated from a rate card.

## 7. Record mapping at a glance

Detail belongs to each slice. This table fixes the targets so slices do not drift.

| Source (LEAP)                              | Target                                                              | Open point                                                           |
| ------------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Person                                     | `directory_person`, `directory_name`                                | `previousName` to name history                                       |
| Card: Company, Trust, Government, Business | `directory_organization`, staff as Directory relationships          | Trust cards carry trustees and beneficiaries                         |
| Card: People with one person               | Contact details on that person                                      | Addresses live on the card, so a person may arrive with several      |
| Card: People with two persons              | Unresolved                                                          | A joint card has no equivalent; needs the owner's ruling             |
| Matter                                     | `matter`, `matter_assignment`, `matter_file_retention`              | Matter type lookup is hand-made per firm                             |
| Card table on a matter                     | `matter_party`                                                      | Role lookup per card table                                           |
| Definable tables                           | `custom_field`, `custom_field_value`                                | Which fields are worth keeping is the owner's call                   |
| Staff                                      | `member`                                                            | A former staff member must own history without being able to sign in |
| Folders, documents, versions               | `folder`, `file`, `file_version`, bytes through the upload pipeline | Whether the extract carries earlier versions                         |
| Emails                                     | `email_message` and its participants and attachments                | Depends on LEAP storing the original message                         |
| Fees and time                              | `time_entry`, `fee_entry`                                           | Rate kept as charged                                                 |
| Cost recoveries                            | `cost_entry`                                                        | Status lookup                                                        |
| Invoices, receipts, credits                | View-only history or live entries, by the matter's money handling   | Section 6                                                            |
| Trust ledger                               | View-only history plus an opening balance, or live ledger entries   | Section 6                                                            |
| Document register, power money             | Custodian packets and items                                         | LEAP's location is one free-text field                               |
| Critical dates, tasks, appointments        | `matter_deadline`, `matter_task`, `matter_event`                    | Whether the extract includes them                                    |
| Precedents                                 | `document_template`                                                 | LEAP merge fields need a lookup to ours                              |

## 8. Build order

1. **Runs and links** (this slice).
2. **Staging store and the first reader** (built, section 11). The reader is for delimited text, because LEAP's CSV reports are the files the owner can produce without LEAP's help.
3. **Directory**: people, organizations and contact details are built (section 13). Duplicate handling is not.
4. **Matters and parties**, with the matter-type and role lookups.
5. **Rehearsal report**, once there are two record kinds to count.
6. **Documents and emails.**
7. **Money**: the per-matter money handling, view-only history and opening balances, the transfer-only path for live entries, the trust gate.
8. **Matter details, custody, dates and tasks, precedents.**
9. **Cutover runbook.**

Slices 2 to 5 need no decision from the owner. Slice 7 is built on the owner's ruling in section 6; the author's additions there are open to correction before it starts.

## 9. Lessons taken from the source

From reading LEAP's reference. Each is either adopted here or already held by `docs/conventions/api.md`.

- **Adopted:** an outside system's key kept on records (LEAP's `legacyCardId`), generalized as section 5. Imported money held as view-only history, which the owner made a choice per matter (section 6).
- **Worth its own decision:** a changes-since feed on list endpoints. LEAP's `rowVersion` and `lastRowVersion` let a client fetch only what changed. Magna Carta's lists are cursor-paged and have no general equivalent.
- **Worth its own design:** a complete, self-describing export of a firm's own data. LEAP has no whole-matter export, which is the reason this framework is needed at all. A firm should be able to leave Magna Carta without one.
- **Already avoided:** endpoints versioned one at a time (288 on v1, 48 on v2, 13 on v3 at once), the same key under four spellings, misspellings frozen into a contract, money as floating point, regional fields inside core records, and eight different error shapes.

## 10. Open questions for the owner

1. Section 6's additions to the owner's ruling: is view-only the right default, and may the choice lock at cutover?
2. Do closed and archived matters transfer, or stay in a LEAP archive?
3. What does a joint card (two people on one People card) become?
4. Which definable-table fields and matter types are worth carrying?
5. Do precedents transfer, or are the ones in use rebuilt?
6. How long a freeze on entry in LEAP is acceptable at cutover?

## 11. The second slice: source files and the first reader

Built 2026-11-13. One per-firm table, and three modules in `@magna-carta/record-transfer`.

**The staging store is the file.** Section 4 first described staging as a table holding every source row. It is built differently, and the reason is what an extract contains. A LEAP card carries a bank account, and an extract will carry tax and identity numbers in whatever column LEAP put them. Copying every row into the firm's database would put those values there in the clear, in a table whose columns nobody can name in advance, which is what the protected-field rule in `docs/conventions/invariants.md` exists to prevent. It would also put bulk content in the database, which belongs in object storage. So a source file is kept whole and unchanged in the firm's object storage, and the database holds only the facts about it.

A row is still individually nameable, which is what staging was for. A reader turns the same bytes into the same numbered rows every time, so "row 4,112 of this file" means one source row for as long as the file is held, and the file's SHA-256 digest says which bytes those were after they are gone.

**`transfer_source_file`** — one file a run was given: `id`, `transfer_run_id`, `source_kind` (what it holds: `matter-list`), `format` (how it is read: `delimited-text`), `file_name`, `object_key`, `byte_length`, `content_sha256`, `key_column`, `row_count`, `registered_at`, `read_at`, `removed_at`.

- The object key is `transfers/{run}/{file}`, built from the two identifiers and never from the file's name.
- The same bytes given twice to one run are refused by a unique index on run and digest.
- `key_column` names the column holding the source system's key for a row, when the file has one. It is the operator's statement about the file, so no LEAP column name is assumed anywhere in the code. The column names of LEAP's reports are known only from a third-party description until a sample file is uploaded.
- `row_count` and `read_at` are written once, by the first complete read.
- `removed_at` records that the bytes were released after cutover. The row stays, because the run's report still names the file.

**The reader for delimited text** (`readDelimitedText`) reads comma-, tab-, semicolon- or pipe-separated text with a header row, following RFC 4180's quoting. It takes text as it arrives and holds one row at a time, so a file's size is not a limit. It changes no value: nothing is trimmed, nothing is read as a number or a date. Each row carries its row number, which links and rejections cite, and the line it starts on, which a person opening the file needs.

- A file that cannot be read as rows is refused with one of four named faults: no header, a blank column name, a repeated column name, or a file that ends inside a quoted value.
- A row with too few or too many values is read and reported, never padded or trimmed, and never a reason to stop. It is a finding for the rehearsal report.
- Fault messages come from a fixed table and hold nothing from the file.

**Not in this slice.** Nothing uploads a file yet. The upload route, the object storage write and the pass that reads a file belong with the operator's screens and the loader. A reader for a database extract is written when the form of LEAP's extract is known.

## 12. Lessons from Clio's migration documentation

Read 2026-11-13 at the owner's request. Clio is the largest practice-management vendor that publishes how it receives a firm from another system, and it receives firms from LEAP. Sources are its help centre: _Clio Manage Data Migration Overview_ (`help.clio.com/hc/en-us/articles/9813884849947`), _Prepare Data For Migration_ (`help.clio.com/hc/en-au/articles/50633872928539`), _Migration Templates for Importing Into Clio_ (`help.clio.com/hc/en-au/articles/9228623050139`), _Import Contacts with Migration Templates_ (`help.clio.com/hc/en-us/articles/50600879151003`) and _Manage Clio Manage Data After Migration_ (`help.clio.com/hc/articles/50704895098907`). Clio's LEAP-specific guide is behind a sign-up form and was not read.

What Clio does, and what this framework takes from it:

| Clio's practice                                                                                                                                                                                      | Taken here as                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Money arrives as balances only. Trust and receivables are one line per matter; trust transactions, invoices, billed time and payments are not migrated, and firms are told to export reports to keep | Confirms the opening-balance half of section 6. Section 6 goes further by keeping the history, view-only or live. **Adopted:** the source's own trust and banking reports are also filed as documents, as a second record     |
| Billable rates are not migrated                                                                                                                                                                      | Already decided the other way: each historical entry keeps the rate it was charged at (section 6)                                                                                                                             |
| Records are joined by matching names exactly. A matter finds its client by first and last name, and a related contact is created "if there is no exact match"                                        | Confirms section 5. A link is a source key, never a name, so a spelling difference cannot make a second client                                                                                                                |
| A missing company, vendor or category is created silently during import                                                                                                                              | **Rejected.** A row that names something the transfer has not carried is a finding in the rehearsal report. Nothing is created to make a row fit                                                                              |
| Dates must be `MM/DD/YYYY`                                                                                                                                                                           | **Adopted differently.** A file's date order is stated by the operator and never guessed, because `03/04/2021` is two different days in an Australian and an American export                                                  |
| "Stop using that system immediately" after export; anything entered later is re-keyed by hand, and a placeholder matter collects work during the gap                                                 | The link table makes a second, smaller run possible. **Adopted as a goal:** a top-up run over a later extract, so the freeze is hours and nothing is re-keyed. It depends on updating a linked record, which is not built yet |
| Time entries and tasks with no user do not import                                                                                                                                                    | Staff are first in the loader's order (section 4), and a former staff member must be representable without a sign-in (section 7)                                                                                              |
| The migrations team does not correct data; errors and duplicates import as they are                                                                                                                  | The rehearsal report lists duplicate candidates and malformed values before cutover, when they are still cheap to fix at the source                                                                                           |
| No undo is documented; the firm is told to contact the migrations team                                                                                                                               | Rehearsal in a throwaway copy is the main answer. **Adopted:** because every link names its run, "everything this run created" is a query, and removing an unaccepted run is a designed operation                             |
| "Do not modify imported data until you have confirmed it is accurate", and integrations stay off until review ends                                                                                   | **Adopted as a rule:** a transferred record sends nothing outward (no notification, no calendar or mail sync) until its run is accepted                                                                                       |
| Rejected rows come back as a downloadable CSV with the error beside each row                                                                                                                         | **Adopted:** the rehearsal report offers each file's rejected rows in the file's own shape, with the reason as a first column                                                                                                 |
| Review is by sample: first and last rows, a mix of open and closed matters, upcoming deadlines first                                                                                                 | **Adopted:** the rehearsal report includes a fixed sample per record kind for a person to check by eye                                                                                                                        |
| Custom fields must exist before their values import, and a field name with `?`, `:` or `/` fails                                                                                                     | Field definitions are created from LEAP's published schema before values (section 7), and a name is carried as written                                                                                                        |
| Documents are scoped and priced separately, by volume                                                                                                                                                | Documents are their own slice (section 8), sized from the extract before it is run                                                                                                                                            |

## 13. The third slice: Directory mapping rules and the loader

Built 2026-11-13. Two modules in `@magna-carta/record-transfer`, and two seams in `@magna-carta/directory`.

**Mapping rules are data the operator states.** `directory-mapping.ts` takes a set of rules saying which column of a file holds which part of a person or an organization: the name parts, every email column, every phone column and whether a fax machine answers it, the address columns, and one country for every address in the file. No column name of LEAP or any other system appears in the code, so the same module carries a report, a table of an extract, or a file from a different system. Mapping is pure: it turns one row into a draft the Directory's own write path accepts, or says why it cannot, and writes nothing.

- **The rules are checked against the header once.** `columnsMissingFrom` lists the columns the rules name that the file lacks, so a misspelt column is one finding before the first row and not one per row.
- **A date's order is stated, never guessed** (section 12). Rules that map a date of birth must say whether the file writes year-month-day, day-month-year or month-day-year, and mapping refuses to run without it. A two-digit year is unreadable, because nothing in the file says which century.
- **A rejection loses the row; a finding loses one value.** A ragged row, or a row with nothing in the name columns, produces no record. An email that is not an address, a phone with no digit in it and a date that cannot be read are left out of an otherwise good record and reported with their column, so a person can find the value in the file. Refusing a whole person over a malformed fax number would lose more than it protects.
- **Trimming happens here.** The reader hands on exact characters (section 11). The mapping rules are the first point at which leading and trailing space is judged to mean nothing, and only for the fields they map.
- The first usable email is the primary. The first number a person can be spoken to on is the primary phone, and a fax line never is. A row with every address column empty has no address, whatever country the rules state.

**The loader writes a record and its link in one commit.** `directory-transfer.ts` holds `transferPerson` and `transferOrganization`. Each reads the link first. A link means the record already arrived, and nothing is written. No link means the record's rows and the link go into one atomic batch, so there is never a record without a link or a link without a record. If two writers race, the link's unique key fails the second batch whole.

- **A transferred record is written by the Directory's own code.** `composePersonRecord` and `composeCreateOrganization` are new exports of `@magna-carta/directory`: the statements `createPersonRecord` and `createOrganization` already built, returned before they are committed. A transferred person therefore gets the same name history, the same phonetic codes and the same audit row as one typed at the New Person screen, and a later change to how a person is stored reaches both.
- **A second run does not update.** A record that already arrived is left as it is, because somebody may have corrected it since and the file it came from is older than the correction. Bringing later changes across from the source (the top-up run of section 12) is a separate operation, to be designed with the rehearsal report.
- A person and an organization may share a source key: the link's key includes the local table.

**Not in this slice.**

- **Duplicate handling.** A transferred person is created even when the Directory already holds someone of the same name. The rule from section 12 stands (nothing is merged silently), and the candidates are to be listed in the rehearsal report from the Directory's existing duplicate search.
- **Sealed identifiers.** Bank, tax and identity numbers are not mapped. They go through the Directory's protected-field path, and the rules for them wait on seeing which columns an extract carries them in.
- **Edges and joint cards.** A person's employer, and a LEAP card that holds two people, are not mapped.
- **The pass that drives it.** Nothing yet reads a file from object storage, runs each row through the rules and the loader, and records the rejections and findings. That pass arrives with the rehearsal report and the operator's screens.
