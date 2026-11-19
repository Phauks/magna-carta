---
category: Added
audience: public
---

**Bates register.** A matter now keeps one register of Bates numbers per prefix (`packages/bates`, table `bates_range` from the `bates-numbers` per-firm migration). A stamp takes its range first, through `POST /api/v1/matters/{matterId}/bates-ranges`; the insert is guarded on no range under the same prefix overlapping it, so two stamps never share a number and a typed start inside a stamped range is refused with 409 `bates-range-taken`. Ranges are append-only by trigger, and the saved copy is recorded once (`.../bates-ranges/{rangeId}/stamped-file`). `GET .../bates-prefixes` answers each prefix with its next number; `GET .../bates-ranges` lists the ranges. The PDF Editor's Bates tab opens on the matter's last prefix with the next number filled in, takes its range before stamping, and records the numbered copy.

## Public

Bates numbers now follow on from one another across a matter. The PDF Editor's Bates tab fills in the next number for you, and every number stamped is logged on the matter with the file and who stamped it, so the same number is never used twice.
