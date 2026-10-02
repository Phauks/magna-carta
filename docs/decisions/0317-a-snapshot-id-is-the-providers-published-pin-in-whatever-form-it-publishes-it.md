---
number: 317
slug: a-snapshot-id-is-the-providers-published-pin-in-whatever-form-it-publishes-it
status: Proposed
date: 2026-08-14
area: AI / inference
summary: "The inference catalog's snapshotId — the value written into every per-request provenance record — holds the provider's own published pinned identifier copied verbatim, in whichever form the provider publishes it, and stays a required field. It is not made optional or absent for models the provider names without a date, because on that provider's newer models the undated id IS the pinned snapshot rather than a pointer to one: recording absence there would assert that no snapshot exists when one does, and would null out the only field that answers which model produced a discoverable work product. Because whether a provider publishes a dated form for a given model is not derivable from anything in the repository, each entry additionally records that form (provider-dated / provider-dateless / platform-composed) as a read fact, and the entry schema refuses an id that contradicts it — which is what turns a fabricated date suffix from a plausible string into a malformed entry. That check lives at the data boundary and fails at module load rather than in the staleness pass, because an id that disagrees with its form is wrong when written rather than wrong as of a date; what does decay — whether the recorded form is still what the provider publishes — is dated by availabilityVerifiedOn and reported by the existing freshness pass alongside the other lifecycle facts."
---

**A provenance field that answers confidently and wrongly is worse than one that is empty, so the
snapshot id is now the provider's published pin or nothing resembling it.**

**Context:** All three Anthropic entries in the model catalog carried an identical `-20260101` suffix —
`claude-opus-4-8-20260101`, `claude-sonnet-4-6-20260101`, `claude-haiku-4-5-20260101`. A uniform date
across three models released at different times is a placeholder somebody wrote once, and it was. Read
against the provider's model reference on 2026-08-14: the provider publishes **no dated form at all**
for Opus 4.8 or Sonnet 4.6, and Haiku 4.5's real dated identifier is `claude-haiku-4-5-20251001`. Three
values, three wrong, one of them wrong in a way that looks right.

This is not cosmetic. `gateway.ts` returns `entry.snapshotId` on the generate, conversation, and stream
paths, and it is persisted on the turn record and in the audit event. That record exists to answer *which
exact model produced this output*. Transcripts here are firm work product and discoverable, so the field
is read by people reconstructing what happened, potentially years later and potentially adversarially. A
snapshot that never existed does not merely fail to answer that question — it answers it falsely, and
does so with the specific authority of a field whose whole purpose is provenance.

**The question the fix turns on:** what should the field hold for a model the provider names without a
date? The instinct is that a bare id is a weaker record than a dated one, and that absence would at
least be honest about the gap. **That instinct is wrong here, and the provider's own reference is what
settles it.** Its note reads: every model id is a pinned snapshot; models with a date in the id are fixed
to that release; *and starting with the 4.6 generation, ids use a dateless format that is also a pinned
snapshot, not an evergreen pointer.* For Opus 4.8 and Sonnet 4.6 the undated id **is** the pin. There is
no date being omitted, because none was ever issued.

So the three candidate designs land differently than they first appear:

- **Absence (make the field optional).** Records "there is no snapshot for this model" — which is false,
  and strictly less informative than the truth. It also nulls the field on the majority of the catalog,
  destroying the reproducibility property for exactly the models the platform actually runs. Rejected.
- **The bare id, field left as-is.** Correct in what it stores. But it leaves a reader who does not know
  the provider's naming convention unable to tell a dateless-but-pinned id from an unresolved alias — the
  conflation the field cannot afford. Insufficient alone.
- **The bare id, plus the form recorded beside it.** What is adopted.

**Decision:** `snapshotId` holds the provider's published pinned identifier, verbatim, and **remains
required** (`z.string().min(1)`). Each entry additionally records `snapshotForm`, one of:

- `provider-dated` — the provider publishes a dated id and `snapshotId` is it (`referenceId` plus a
  `-YYYYMMDD` suffix). Here the undated name is a convenience alias, so the date is load-bearing and
  recording the alias instead would name a pointer rather than a release. Haiku 4.5.
- `provider-dateless` — the provider publishes no dated form; the undated id is itself the pin, so
  `snapshotId` equals `referenceId`. The equality is the complete record, not an abbreviation of one.
  Opus 4.8, Sonnet 4.6.
- `platform-composed` — no provider identifier applies. The embedding entry composes its own, binding the
  model to the index generation its vectors belong to, because that pairing is what makes a stored vector
  interpretable.

**The form has to be recorded rather than derived, and that is the whole reason the field exists.**
Whether a provider issues a dated id for a given model is simply not present anywhere in this repository.
Without the declaration, `<referenceId>-20260101` and `<referenceId>-20251001` are indistinguishable —
both are well-formed, and no structural rule separates the real one from the invented one. With it, the
contradiction is checkable, and `catalogEntrySchema` checks it: a dateless entry whose id carries a
suffix, or a dated entry whose id has lost its date, is a malformed entry.

**Where the check lives, and why not in the freshness pass.** The staleness pass added alongside this
catalog reads facts a calendar can settle and grades them `due` or `expired`. A snapshot id that
contradicts its own declared form is a different kind of defect: it is wrong the moment it is written and
stays wrong, with no date at which it becomes so. It therefore belongs at the data boundary, where the
catalog's other invariants already live — the reasoning entries' ZDR eligibility, tier occupancy, the
embedding pin state — and where it fails at **import**, for every consumer, rather than waiting for a
gate to run. Routing it through the freshness pass instead would have let a fabricated id sit in the tree
and in every provenance record written meanwhile.

The freshness pass still has a part, and it is the part that genuinely decays: whether the recorded form
is still what the provider publishes. That is read off the same reference page as the retirement date and
the successor, so it is dated by the same `availabilityVerifiedOn` field and reported by the same
`lifecycle-facts-unread` finding — now named explicitly in the field's documentation and in the pass's
report text, so "re-read the lifecycle facts" unambiguously includes "re-read the snapshot id". What
neither mechanism can see is a provider restating an id in a different form since the last read; that gap
is bounded by the re-read interval rather than closed, on the same terms as supersession.

**Considered and rejected:** **Making `snapshotId` optional and absent for dateless models** — asserts a
falsehood and nulls the field for most of the catalog (above). **Deriving the form from the string's
shape** — circular; the shape is exactly what is in question. **A structural rule with no declared form**
("`snapshotId` must equal `referenceId` or `referenceId` plus a date") — every one of the three wrong
values satisfies it, so it would have passed the defect it was written for. **Storing the form in the
provenance record too** — it would require changing `gateway.ts` and the persisted row shape to carry a
fact that is constant per model and already recoverable from the catalog; the record needs the id, and
the catalog is where the id is explained.

**Consequences:** The three Anthropic snapshot ids are corrected. No model changed, no tier moved, and
no selection decision is taken here — which model occupies a tier remains the owner's call and is
flagged separately. The catalog gains a required field, so every entry and every test fixture declares
one. `gateway.ts` is untouched: it returns `entry.snapshotId` exactly as before, because the shape did
not need to change — only the value was wrong.

**No persisted row needs correcting.** The only table carrying `snapshot_id` is the Magnus turn record,
created by `20260806T050000_magnus-conversations.sql`, which is not present on the `release` branch that
Workers Builds deploys from — `release` is at 2026-07-04 and predates both the migration and the assistant
that writes through it. No environment has the column, so no environment holds a row asserting a snapshot
that never existed, and the correction needs no note attached to historical data. Had any row existed,
whether to annotate it would have been the owner's decision rather than this branch's.
