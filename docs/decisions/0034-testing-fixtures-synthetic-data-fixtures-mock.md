---
number: 34
slug: testing-fixtures-synthetic-data-fixtures-mock
status: Accepted
date:
area: Testing & fixtures
---

**Synthetic data & fixtures:** mock matters generated **through the real domain write-paths, never raw inserts** (valid by construction; doubles as write-path coverage). One **seeded, deterministic** engine (fixed clock + seeded IDs) with three entry points — asserted **scenarios**, a curated **demo-firm bundle**, and a snapshot-replayable **load profile**; layered content (faker + real `.docx` templates). Confined to a **demo tenant**, **never runs in production**. Raw-SQL seeding rejected (bypasses ledger/trust/conflicts invariants, drifts from schema).
