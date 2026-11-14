---
slug: a-transfers-staging-store-is-the-source-file-itself
status: Accepted
area: Platform
date: 2026-11-13
summary: "A record transfer stages a source file by keeping it whole and unchanged in the firm's object storage, with one transfer_source_file row of facts about it (kind, format, size, SHA-256 digest, key column, row count). No source row is copied into the firm's database. A row is named by its file and its number in it, which a reader reproduces from the same bytes every time."
---

**A transfer's staging store is the source file itself.**

**Context:** The record-transfer framework needs somewhere to hold what a firm brought from the system it is leaving, unchanged and apart from its live data, so that a rejected row can be cited and a mapping can be run again. The framework's design first described that as a table holding every source row. Building it raised what an extract contains: LEAP's cards carry bank account details (reference version 1.3.0), and an extract will carry tax and identity numbers in whatever column the source put them.

**Decision.** The author's recommendation, built on the owner's instruction of 2026-11-13 to continue.

1. **The file is kept whole in the firm's object storage**, under a key built from the run and file identifiers and never from the file's name. `transfer_source_file` holds the facts about it and nothing of its content.
2. **A row is named by file and row number.** A reader is deterministic, so the same bytes give the same numbered rows on every read. The digest identifies the bytes after they are released.
3. **A reader interprets nothing.** It yields values as characters. A file that cannot be read as rows is refused with a named fault; a row of the wrong width is reported and reading continues.

**Consequences.** Sensitive values in an extract never enter the firm's database in the clear, which a table of staged rows could not promise without knowing every column in advance, and bulk content stays in object storage. The cost is that a mapper reads a file in order and cannot look one row up by key; a mapping that needs to join two files builds its own index for the pass, in memory or as keys only. A report of rejected rows cites file and row number, and the operator opens the file to see the row.
