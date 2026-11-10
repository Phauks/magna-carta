# Record transfer framework (LEAP first) — design

**Date:** 2026-11-10 · **Status:** Accepted (framework and first slice); later slices proposed · **Area:** Platform / Core domain
**Builds on:** the white paper's _LEAP migration_ topic and ADR-0021 (migration deferred, legacy identifiers required, trust reconciliation as the cutover gate)
**Decisions:** `docs/decisions/pending/a-transferred-record-is-linked-to-its-source-in-one-table.md`
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
| 2. Staging store      | Holds every source row unchanged, with the file and row it came from, apart from the firm's live data                                                          | No                                  |
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

Recommended, and not yet ruled on by the owner.

- **Imported money is view-only history.** Trust and office transactions from the source are kept as dated, read-only records beside the live ledger, and an opening balance per matter is posted to the ledger at cutover. They are not replayed through the live posting rules, which were written for entries made here (approval, authority, rate lookup) and would reject or reinterpret history. This is the pattern LEAP itself uses for firms arriving from elsewhere.
- **One rounding rule.** Floating-point amounts become integer minor units by rounding half away from zero. Each matter's converted total is compared with the source's own total, and a difference is reported, never absorbed.
- **The gate.** Cutover is refused unless every matter's opening trust balance equals the source's balance, the total equals the bank, and the view-only history for each matter sums to its opening balance.
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
| Invoices, receipts, credits                | View-only history; open items as live invoices                      | Section 6                                                            |
| Trust ledger                               | View-only history plus opening balances                             | Section 6                                                            |
| Document register, power money             | Custodian packets and items                                         | LEAP's location is one free-text field                               |
| Critical dates, tasks, appointments        | `matter_deadline`, `matter_task`, `matter_event`                    | Whether the extract includes them                                    |
| Precedents                                 | `document_template`                                                 | LEAP merge fields need a lookup to ours                              |

## 8. Build order

1. **Runs and links** (this slice).
2. **Staging store and the first reader**, proved on LEAP's CSV reports because those are the files the owner can produce without LEAP's help.
3. **Directory**: people, organizations, contact details, duplicate handling.
4. **Matters and parties**, with the matter-type and role lookups.
5. **Rehearsal report**, once there are two record kinds to count.
6. **Documents and emails.**
7. **Money**: view-only history, opening balances, the trust gate.
8. **Matter details, custody, dates and tasks, precedents.**
9. **Cutover runbook.**

Slices 2 to 5 need no decision from the owner. Slice 7 needs section 6 ruled on.

## 9. Lessons taken from the source

From reading LEAP's reference. Each is either adopted here or already held by `docs/conventions/api.md`.

- **Adopted:** an outside system's key kept on records (LEAP's `legacyCardId`), generalized as section 5. Imported money held as view-only history (section 6).
- **Worth its own decision:** a changes-since feed on list endpoints. LEAP's `rowVersion` and `lastRowVersion` let a client fetch only what changed. Magna Carta's lists are cursor-paged and have no general equivalent.
- **Worth its own design:** a complete, self-describing export of a firm's own data. LEAP has no whole-matter export, which is the reason this framework is needed at all. A firm should be able to leave Magna Carta without one.
- **Already avoided:** endpoints versioned one at a time (288 on v1, 48 on v2, 13 on v3 at once), the same key under four spellings, misspellings frozen into a contract, money as floating point, regional fields inside core records, and eight different error shapes.

## 10. Open questions for the owner

1. Is imported money held as view-only history with opening balances (section 6), or is full history replayed into the live ledger?
2. Do closed and archived matters transfer, or stay in a LEAP archive?
3. What does a joint card (two people on one People card) become?
4. Which definable-table fields and matter types are worth carrying?
5. Do precedents transfer, or are the ones in use rebuilt?
6. How long a freeze on entry in LEAP is acceptable at cutover?
