---
category: Changed
audience: internal
---

**Designed the reversal of the ingest quarantine posture: every upload that completes commits, and a
safety or type finding becomes a property of a committed version rather than a reason to have no
version at all.** Design only — nothing is built. The owner's ruling is that a file the user gave us
is kept and it is up to the user to deal with it, because for a law firm silently refusing a client's
document on a heuristic is a worse failure than holding a flagged one.

The spec (`docs/specs/2026-08-22-always-commit-ingest-design.md`) establishes what still refuses (a
truncated transfer, an abandoned session, and a presign-time quota if one is adopted — never
content), replaces the five gate quarantines with rows in a new per-version `file_version_finding`
table that records both sides of a disagreement, and extends `flaggedTreatment` from the one route
that enforces it today to the offline checkout, the editor launch, the preview grant and the bulk
bundle, so a firm on `block` keeps blocking behaviour everywhere while the file is kept. It
enumerates every read that assumes the current version is clean, renames `clean` to `committed` and
`quarantined` to `withdrawn`, designs the matter-scoped analysis surface and the sniffed-type
recording the owner asked for, and rehabilitates existing ingest quarantines while leaving custody
withdrawals alone.

Two findings that fall out of the audit and are worth knowing independently of the design: four byte
paths reach a flagged committed version with no verdict check at all today (offline checkout, editor
launch, bulk bundle, search indexing), and the weekly re-scan sweep is described in the File Manager
notes but attached to no Cron trigger and called from nowhere, so the only re-examination the corpus
ever gets is the access-triggered one.

Decision: `docs/decisions/pending/a-system-of-record-keeps-the-file-it-was-given.md`, superseding the
quarantine-on-content posture of ADR-0081 and the ingest half of ADR-0158. Seven owner questions are
numbered in the spec, the load-bearing two being the default `flaggedTreatment` for a newly committed
flagged file and whether a flagged document's text may be indexed.
