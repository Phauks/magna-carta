---
slug: a-transferred-record-is-linked-to-its-source-in-one-table
status: Accepted
area: Platform
date: 2026-11-10
summary: "The legacy source-system identifier ADR-0021 requires on every entity is one per-firm table, source_record_link, keyed by (source_system, source_kind, source_id, local_table) and naming the record here by table and key, with a transfer_run row as its provenance. It is not a column on each entity. A source record may become several records and several may become one, a link is read before any record is created so a transfer can be run twice, and the same table serves any integration that keeps an outside system's key."
---

**A transferred record is linked to its source in one table, read before anything is written.**

**Context:** ADR-0021 deferred the LEAP migration and required that every entity carry its legacy source-system identifier, so a record here can always be traced to the record it was. The owner asked on 2026-11-10 for the transfer framework to be built, assuming an extract from the vendor. LEAP's published API reference (version 1.3.0, read 2026-11-10) shows the shape of what will arrive: every record is keyed by a GUID separate from its display number, one card can hold several people, and one record there can become more than one here.

**Decision.** Two rulings, both the author's recommendation, built on the owner's instruction of 2026-11-10 to proceed with development.

1. **One link table, not a column per entity.** `source_record_link` holds `(source_system, source_kind, source_id)` and the record it became as `(local_table, local_id)`, with the `transfer_run` that wrote it. A column on each entity cannot say that one source record became two records, or that two became one, and LEAP's cards do both. A column on every table is also a migration on every table, where the link table is one migration for all of them. `local_table` carries no foreign key; the tables a link may name are listed in `@magna-carta/record-transfer` and a write refuses any other.
2. **The link is read before a record is written.** A mapper asks for the link first. A row means update the record it names; no row means create one and insert the link in the same batch. The insert has no conflict clause, so a second record for the same source record is a fault that surfaces, never a silent duplicate. This is what makes a rehearsal repeatable and a top-up run possible.

**Consequences.** ADR-0021's requirement is met for every entity at once, including entities that do not exist yet. The table is general: an integration that needs to remember an outside system's key for a record uses the same rows under its own `source_system`. The cost is that "what was this record" is a second read, not a column on the row, and that `local_table`/`local_id` are held to the schema by a test and a write-time check where a foreign key would otherwise do it. How imported money is held is its own decision, recorded beside this one. Trust reconciliation remains the cutover gate ADR-0021 named.
