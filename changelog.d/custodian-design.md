---
category: Added
---

**Design spec and implementation plan for Custodian (slice 4·2).** The second half of the Phase 4
deliverable now has an implementation-grade design: the register of physical originals a firm holds
in safekeeping — wills, deeds, share certificates, keys, sealed instructions — with the location tree,
the movement ledger, and the compliance seams specified against what is already on `main`.

**A packet is the unit of custody; an item is the unit of description.** A packet is the envelope or
deed box that physically moves and carries the number, the location, the owners, and the optional
matter link; an item is one thing inside it, with a type drawn from a per-firm catalog and an
intrinsic-value flag a human asserts. An item never moves between packets by an edit — re-packeting
is a ledger entry, because "when did the will move out of the family envelope" has to have an answer.
**Ownership anchors at a Directory entity and is mandatory**, not at a matter: a firm holds a will for
a client whose last matter closed eleven years ago, for the adult child of a client, for an estate,
and rooting custody at the matter would make every one of those either impossible or a fake matter.
The catastrophic outcome in safe custody is not a misplaced packet but an unattributable one, so
orphan prevention is structural rather than a reminder.

**One recursive location tree, rooted optionally at a firm Location** — the sentence the Locations
model has carried since slice 1·1, made enforceable for the first time. A root bound to a Location is
an office root, which is what makes "which office physically holds this original" answerable for a
multi-office practice; a root of kind `offsite` or `bank` is an external custody site, because a bank
vault is not a firm office and minting a Location for one would corrupt the letterhead picker and the
per-office reporting dimension every other subsystem reads. Capacity is explicitly out of scope with
no column reserved: it is a count for a pigeonhole rack, a volume for a safe, a weight for a shelf,
and a contractual allowance for a bank, and a schema that picks one is wrong for the other three.

**The movement ledger is append-only, enforced by database triggers, and `POST /movements` is the only
state-change path in the whole subsystem.** There is no check-out route, no check-in route, no move
route, no mark-lost route — all of them are one movement kind, so one place enforces the invariant,
writes the derived status in the same atomic batch, and composes the audit row. A correction is a new
compensating row, never an edit. `occurred_at` and `recorded_at` are separate columns so back-dating a
Friday event on a Monday is supported and visible rather than indistinguishable from falsification.
Borrower is three-way (firm member, Directory entity, or an external name) because forcing a courier
into the Directory would pollute the conflicts corpus, and `due_back_on` ships in the first slice
because an overdue check-out is _the_ operational signal a custody register produces and retrofitting
the column leaves every earlier check-out permanently silent. A movement can reference a `shipment`,
so the offsite transport leg reuses the shipping subsystem — carrier, tracking, signature on delivery,
insured value — rather than growing a second one.

**Custody numbers reuse the matters allocation-ledger idiom** (ensure-row, guarded increment,
allocation claim, bounded retry) rather than re-deriving the race, with a fixed number shape instead
of a second segment-template engine. **Scanned copies are ordinary File Manager files** behind the
ordinary quarantine chokepoint with no bypass, linked through a `custody_scan` row; the awkward part —
`file.matter_id` is `NOT NULL` and a custody owner may have no matter — is resolved by filing a
matterless packet's scans onto a per-firm `system` holding matter rather than weakening an invariant
seven subsystems depend on. A scan never satisfies any destruction gate: "we have a scan" is precisely
the reasoning that destroys an original will.

**Retention ships as mechanism with no policy.** Holds (`legal`, `discovery`, `client_instruction`,
`dispute`, `unclaimed`) block release and destruction while still permitting a move to a fireproof
safe, and become the first real consumer of the Custodian hold blocker the deleted-file lifecycle was
written against. Destruction is a two-person request-and-approval workflow, refused under any hold and
refused outright on an intrinsic-value item with **no override in the API**. But no retention periods
ship, no jurisdiction catalog ships, and no destruction sweep exists: retention for client property is
the most jurisdiction-bound fact in the subsystem — five years under the model rule and Texas, seven
in New York and Illinois, fifteen in Ontario, ten under one liability fund's guidance — while the
guidance that governs originals of intrinsic value says they sit outside the routine clock entirely.
A platform default there is a platform opinion about when to destroy a client's irreplaceable property.

The earlier brainstorm on `main` (`docs/specs/2026-06-16-safe-custody-design.md`) is evaluated rather
than inherited: its MVP-first framing, the Location-rooted tree, mandatory ownership, and the deferred
will-on-death engine are kept; its flat item model, its invented co-ownership enum, and its
per-item-type retention defaults are discarded, each with the reason stated. Eleven owner decisions
are flagged, including the packet/item split, whether the mandatory owner link admits any exception,
the scan-filing shape, and whether the will-on-death statutory engine — the largest piece of deferred
value and the clearest separation from the incumbents — is wanted at all.

Specs: `docs/specs/2026-08-04-custodian-design.md` and
`docs/specs/2026-08-04-custodian-implementation-plan.md`. Decisions:
`docs/decisions/pending/custodian-register-model.md` and
`docs/decisions/pending/custodian-retention-jurisdiction-posture.md`.
