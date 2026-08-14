---
category: Fixed
audience: internal
---

**Every Anthropic model in the inference catalog recorded a snapshot that never existed, and the field
that recorded it is the one that answers which model produced a discoverable work product.**

All three entries carried an identical `-20260101` suffix — `claude-opus-4-8-20260101`,
`claude-sonnet-4-6-20260101`, `claude-haiku-4-5-20260101`. A uniform date across three models released
at different times is a placeholder somebody wrote once, and it was. Read against the provider's model
reference on **2026-08-14**: the provider publishes **no dated form at all** for Opus 4.8 or Sonnet 4.6,
and Haiku 4.5's real dated identifier is `claude-haiku-4-5-20251001`.

**Why this is not cosmetic.** `gateway.ts` returns `entry.snapshotId` on the generate, conversation, and
stream paths, and it is persisted on the Magnus turn record and in the audit event. That record exists to
answer _which exact model produced this output_, and it is read by people reconstructing what happened —
potentially years later, potentially adversarially. A snapshot that never existed does not fail to answer
that question; it answers it falsely, with the authority of a field whose entire purpose is provenance.

**What the field now holds, and the part that is counter-intuitive.** The instinct is that a bare
undated id is a weaker record, and that absence would at least be honest. The provider's own reference
settles it the other way: every id it publishes is a pinned snapshot, and _from the 4.6 generation on,
ids use a dateless format that is also a pinned snapshot, not an evergreen pointer._ For Opus 4.8 and
Sonnet 4.6 the undated id **is** the pin — nothing is being omitted, because no date was ever issued.
Recording absence there would assert that no snapshot exists when one does, and would null the field for
most of the catalog. So `snapshotId` stays **required**, holds the provider's published pin verbatim, and
the three values are corrected to `claude-opus-4-8`, `claude-sonnet-4-6`, and `claude-haiku-4-5-20251001`.

**The part that stops it recurring.** Whether a provider issues a dated id for a given model is not
derivable from anything in this repository — which is precisely why the placeholder survived: nothing
could tell `<referenceId>-20251001` from `<referenceId>-20260101`, since both are well-formed. Each entry
now records the **form** it read off the provider's reference — `provider-dated`, `provider-dateless`, or
`platform-composed` (the embedding entry, which binds the model to its index generation) — and
`catalogEntrySchema` refuses an id that contradicts it. A date suffix on a model the provider publishes
undated is now a malformed entry, not a plausible string.

**That check fails at import, not at the gate, and the distinction is the point.** The staleness pass
added alongside this catalog grades facts a calendar can settle. An id that disagrees with its own form
is wrong the moment it is written and stays wrong — there is no date at which it becomes so — so it sits
at the data boundary with the catalog's other invariants (ZDR eligibility, tier occupancy, the embedding
pin state) and fails for every consumer at import. Routing it through the freshness pass would have let a
fabricated id sit in the tree, and in every provenance record written meanwhile, until someone ran the
gate. The freshness pass keeps the half that genuinely decays: the snapshot id is read off the same
provider page as the retirement date and the successor, so it is dated by the same `availabilityVerifiedOn`
field and reported by the same `lifecycle-facts-unread` finding — now named explicitly in the report text,
so "re-read the lifecycle facts" unambiguously includes "re-read the snapshot id".

**No persisted row needs correcting.** The only table carrying `snapshot_id` is the Magnus turn record,
created by a migration that is not on the `release` branch Workers Builds deploys from — `release` sits at
2026-07-04 and predates both the migration and the assistant that writes through it. No environment has
the column, so no environment holds a row asserting a snapshot that never existed.

**No model changed.** No tier moved, no selection was taken, and `gateway.ts` is untouched — it returns
`entry.snapshotId` exactly as before, because the shape was never the problem. Which model occupies each
tier remains the owner's open decision.
