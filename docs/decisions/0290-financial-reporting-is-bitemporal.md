---
number: 290
slug: financial-reporting-is-bitemporal
status: Proposed
date: 2026-08-13
area: Reports
summary: "Every ledger-backed report reads two date axes, not one: an effective-date period and a knowledge instant (`recorded_at` / `applied_at`). Both columns already exist, both live on append-only tables, and neither is ever updated — so a report parameterized by the triple (periodStart, periodEnd, knownAsOf) is a pure function of rows that cannot change, and re-running the triple in five years returns the same integers. A single-axis read filtered only on effective_date would let a reversal posted next month with a backdated effective date silently change last month's answer after somebody signed it, which is the exact failure ADR-0246 froze the three-way reconciliation to prevent; reintroducing it in every report would undo that decision by the back door. Omitting knownAsOf is legal and means 'now', which produces a LIVE result stamped computedAt and explicitly not claimed to reproduce — the two are labelled differently in the payload and on the produced artifact, because a reader cannot tell them apart from the figures. Reproducibility is a claim about FIGURES only: display names, entity merges, office letterhead and jurisdiction citations are mutable captions carried beside stable ids, so a re-run may render different labels against identical amounts, and the audit pack states that in its own words rather than implying more than it can deliver. Reads whose underlying stores are mutable (work in progress, productivity) do not accept knownAsOf at all — the parameter is absent rather than accepted and ignored."
---

**A financial report reads two date axes, and the pair is what makes an audit pack evidence rather
than a snapshot.**

**Context:** A bar-audit pack is produced for a regulator. Its central property is that the same
period re-run later gives the same answer, or states precisely why it cannot. The obvious design —
filter on the effective date and be done — does not have that property, and the reason is already
recorded in this repository: `ledger_entry.effective_date` is backdatable, so an entry posted next
month can land inside last month's period. ADR-0246 met exactly this problem for the three-way
reconciliation and solved it by freezing the attestation. Every other report would have carried the
defect the freeze was invented to contain.

**Decision:** Every ledger-backed read takes `(periodStart, periodEnd, knownAsOf)` and filters
`effective_date` for the period and `recorded_at <= knownAsOf` for what was known. The knowledge
columns exist on every append-only table these reads touch — `ledger_entry.recorded_at`,
`invoice_application.applied_at`, and the created-at stamps on the trust and credit-note records —
and none of them is ever updated. No new column, no new table, no backfill.

Omitting `knownAsOf` means now and yields a **live** result: stamped `computedAt`, carrying an
explicit non-reproducibility flag, rendered differently. The distinction lives in the payload because
it is invisible in the numbers.

Reproducibility is scoped to **figures**. Directory display names, entity merges, matter titles,
office letterhead, and the jurisdiction corpus's citation text are all mutable, and all of them are
captions. Every ledger line, every client ledger, and every matter carries its stable id beside the
caption; the produced artifact snapshots the captions as they stood; and the pack says, in words a
reader outside this repository can follow, that the amounts reproduce for the stated period and
knowledge instant while the names are as they stood when it was produced.

A read over a mutable store does not accept the knowledge parameter at all. Accepting it and ignoring
it would be the worst of the three options.

**Considered and rejected:** **One axis (effective date only)** — simpler, and it makes last month's
figures change next month, which is the failure the reconciliation freeze exists to prevent.
**One axis (recorded_at only)** — reproducible and wrong: it places a backdated correction in the
month it was typed rather than the month it belongs to, which is not how a set of books reads.
**Freeze every report the way the reconciliation is frozen** — the reconciliation is frozen because
it is an *attestation a person signs*; freezing an arbitrary read would mean storing figures, which
is the materialisation this slice refuses, and it would multiply stored numbers that can drift from
the ledger. The two-axis read gives the same reproducibility with nothing stored.
**Claim reproducibility over names as well, by snapshotting every caption into the query** — it would
require the projection layer to hold a versioned copy of the directory, which is a second system of
record for identity and a far larger commitment than the problem justifies. The produced artifact
already preserves what a specific reader was given.

**Consequences:** An examiner can be told, honestly, what will and will not reproduce. A backdated
posting into a closed period is visible as a live-versus-frozen difference rather than as a silently
changed document. And the projection layer needs no frozen columns of its own: the reproducibility
comes from columns the ledger already had.
