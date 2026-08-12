---
number: 263
slug: billing-fee-models
status: Accepted
date: 2026-08-07
area: Billing
summary: "ALL FOUR FEE MODELS BUILD NOW, on the shipped invoice spine, per the owner's docket override of the staged B9 default — and the FEE AGREEMENT IS A PER-MATTER, APPEND-ONLY, VERSIONED RECORD: a fee change is a new version whose insert closes the prior version's valid_to in one batch, versions are dense per matter by trigger, exactly one version is in force by partial unique index, and the only UPDATE a version ever takes is that one-time close — because invoice lines record the agreement version that composed them (a new invoice_line.billing_arrangement_id), so an edited agreement would rewrite what a finalized bill was computed under. Absence of an arrangement means hourly, so no matter needs a backfill and the shipped hourly path is untouched except that a flat-fee or contingency matter now REFUSES hourly time claims by name (costs stay claimable — advancing a filing fee is not a fee model, and a retainer is a funding arrangement whose time still bills hourly). The flat fee is one line plus zero-amount claims exactly as the invoice-model decision anticipated, with instalments representable and over-billing REPORTED by fitness query rather than blocked. The CONTINGENCY FEE IS ALWAYS DERIVED, NEVER STORED AS A DECIDED NUMBER: matter_recovery records the settlement/judgment/award (append-only, void-with-reason its only edit), and the fee is computed at composition from the agreement's share against the recoveries as they stand — under the recorded costs-before-or-after election, where net-after-costs deducts the matter's advanced (hard) costs and never its soft costs — landing as an ordinary reviewable fee line that snapshots the share in the rate position. Settlement disbursement statements and lien handling remain deferred exactly as designed. The EVERGREEN RETAINER records target and floor on the agreement (the floor is business configuration, never the trust leaf's structural min_balance), reads trust's own AVAILABLE figure, and records a retainer_replenishment_request (observed balance + shortfall, one open per matter by partial unique index, resolution its only edit) emitting billing.retainer.replenishment_requested — the notifications seam, with delivery and the below-floor automation belonging to slice 3·7. NO NEW TRUST WRITE SHAPE EXISTS ANYWHERE IN THIS: an advance flat fee or retainer deposit sits where the agreement's recorded advance-deposit destination says, and money leaves trust only through the existing earned-fee application against a finalized invoice. And per owner override B4, THE MULTI-MATTER RENDER SHAPE IS A FACT ON THE INVOICE MODEL: a firm-level default (per-matter pages plus a summary is the shipped default) overridable per finalize and SNAPSHOT onto invoice.render_shape with the letterhead — a later change to the default must not re-shape a document already given to a client — with the per-page/summary derivation shipped as a read and the PDF tail explicitly separate work. Hybrid arrangements (e.g. capped hourly, hourly-against-contingency) are NOT built and not schema'd: the design names no semantics for them, and inventing any would decide fee-agreement law the owner has not been asked about."
---

**All four fee models build now on the invoice spine; the fee agreement is an append-only versioned
record; the contingency fee is derived, never stored; and the multi-matter render shape is snapshot
on the invoice.**

**Context:** The billing design staged the fee models (hourly first, flat fee and retainer as
configuration, contingency recorded-only) and the owner overrode the staging in the decision docket:
build all fee models, and render multi-matter invoices as per-matter pages plus a summary at the
firm's choice. The invoice spine and the trust application shipped in the two sub-slices before
this, so the models compose onto working machinery.

**Decision:**

1. **The fee agreement (`matter_billing_arrangement`) is per-matter, versioned, append-only.** A fee
   change is a new version; the superseded version's `valid_to` closes in the same batch and nothing
   else about it can ever change (dense versions by trigger, one open row by partial unique index,
   close-only updates by trigger). Invoice lines composed under an agreement carry
   `billing_arrangement_id`, so a finalized bill's basis is permanent. Absence means hourly; no
   backfill.

2. **Kind-specific shape is held by CHECK:** a flat fee carries its amount; a contingency carries its
   share (rate-scale, at most the whole recovery) and its costs-before-or-after election; a retainer
   carries its target and floor, floor at most target. The advance-fee deposit destination — trust or
   operating — is recorded per agreement and never defaulted.

3. **Flat fee:** one `flat_fee` line, contributing time claimed at zero with no line, instalments
   representable, over-billing against the agreed total reported by fitness query. Hourly time claims
   on a flat-fee or contingency matter refuse by name; cost claims stay ordinary.

4. **Contingency:** `matter_recovery` is the recorded fact (void-with-reason its only edit) and the
   fee is computed at composition from the share against the non-voided recoveries — net of the
   matter's advanced (hard) costs under the `net_after_costs` election, counting only `approved` and
   `billed` cost entries (a draft cost is a claim nobody has confirmed) — never stored as a decided
   number anywhere but the reviewable line it produces. **The fee is billed as an offset, never
   re-derived from scratch onto a new bill — and the offset spans the matter's whole
   contingency-agreement chain, not the version:** the line charges the current entitlement minus
   every contingency fee already on a finalized bill under ANY version of the matter's contingency
   agreement, because an amendment mints a new version without minting a new recovery, so a later
   recovery bills exactly its own increment even across a re-signed engagement letter; a draft
   carries at most one contingency line, and a compose with nothing left refuses. **Under a share
   CHANGE the entitlement re-levels to the in-force share against the current basis with the
   matter-level offset unchanged: a raised share bills the difference, and a lowered share whose
   entitlement falls below what was already billed refuses to compose and is carried as a finding
   by the fitness report — what the firm owes back is a credit-note decision, not one the platform
   makes.** A basis that shrinks after billing (a voided recovery, a late advanced
   cost) is beyond any write-path guard — the bill was true when it issued — and is surfaced by the
   `contingencyBilledBeyondEntitlementStatement` fitness report against the surviving basis.
   Settlement disbursement statements stay deferred. The line-to-version binding is likewise
   re-proved over stored rows (`invoiceLinesUnderArrangementsNotInForceStatement`: a finalized
   line's version must have governed the bill's issue date) rather than guarded in the batch, where
   a zero-row guarded write aborts nothing.

5. **Retainer:** target and floor on the agreement; status read from trust's available balance;
   `retainer_replenishment_request` records the ask (one open per matter, resolution-only edits) and
   emits `billing.retainer.replenishment_requested`. Delivery and automation are slice 3·7's.

6. **No new trust write shape.** Advance fees sit where the recorded destination says; earned fees
   leave trust only through the existing finalized-invoice application. Nothing in the fee models
   composes a trust statement.

7. **Render shape (owner override B4):** `invoice.render_shape` is snapshot at finalize from the
   firm's default (`per_matter_pages` ships as the default) or a per-invoice override; the
   per-matter-pages-plus-summary derivation is a read; a null column (drafts, pre-column invoices)
   derives as combined. The PDF rendering is separate work.

8. **Hybrid arrangements are future work, not invented:** the design names no semantics for them,
   so no schema or code pretends to.

**Consequence:** Every fee model a practice-management platform is expected to carry is now
recordable and billable, the owner's B9 and B4 directions are closed, and the remaining billing work
(taxes, credit notes and client credits, presentation/delivery/LEDES, settlement statements) sits on
seams this deliberately did not touch.
