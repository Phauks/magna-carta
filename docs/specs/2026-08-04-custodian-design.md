# Custodian — design (slice 4·2)

**Date:** 2026-08-04
**Status:** Design proposed; owner decisions in section 14 are open. No product code in this cycle.
**Scope:** The custody-item model and what a packet may contain, the physical-location tree rooted
at a Location, the append-only movement ledger, firm-scoped custody numbering, the binding between a
custody item and its scanned copies, the review and destruction **seams**, the HTTP contract, the
telemetry, and the load-profile fit. Excludes: the user interface (named as seams only, section 11),
the will-on-death statutory deadline engine, stocktake reconciliation, signed deposit and release
receipts, and portal visibility of held items — each is a named later slice with its seam placed here.
**White-paper home:** _Custodian_, with _Locations_ (the custody root), _Matters and File Manager_
(the ingest chokepoint and the version model), _Directory_ (owners and depositors),
_Document versioning & storage tiering_ (retention, holds, destruction), _Tenancy and data isolation_,
and _Notifications_ (the reminder delivery seam) as the surrounding context.
**Governing decisions:** ADR-0014 (Custodian — location hierarchy, custody log, labels, scans,
reminders), ADR-0068 (Location as a dimension, not a tenancy boundary), ADR-0003 (tenancy),
ADR-0049 (deleted-file lifecycle; destruction blocked by Custodian holds), ADR-0077 (immutable
versions), ADR-0078 (content hash on write; cheap seams up front), ADR-0079 (matter number frozen at
assignment; the allocation-ledger idiom), ADR-0081 (inbound upload + quarantine chokepoint),
ADR-0083 (load-profile accretion), ADR-0084 (`protected()` fields), ADR-0067 (route metadata and the
chokepoint), ADR-0085/ADR-0086 (the Directory model), ADR-0008 (append-only discipline, borrowed by
analogy — the ledger invariants themselves do not bind here).
**Decision inputs:** the prior brainstorm on `main`,
[`docs/specs/2026-06-16-safe-custody-design.md`](2026-06-16-safe-custody-design.md) (what this spec
keeps and what it discards is stated in section 1); the shipped substrate this design is obliged to
reuse — `@magna-carta/locations`, `@magna-carta/directory`, `@magna-carta/matters` (the
counter/allocation numbering idiom), `@magna-carta/file-manager` (versions and the ingest
chokepoint), `@magna-carta/custom-fields`, `@magna-carta/shipping` (the physical-transport leg), the
`conflicts_*` append-only trigger migration, and the telemetry catalogs. A survey of what safe
custody means in practice (LEAP, Actionstep's deed-packets application, Smokeball's and Clio's
region-gated registers, triSearch, Konekta) informs the capability shape in section 1 and nothing
else.

## Why now

Slice 4·1 shipped the conflicts engine, and Custodian is the other half of the Phase 4 deliverable.
Every input it consumes is already on `main`: Locations exists as a first-class per-firm entity and
was designed from the start as "the Custodian root"; the Directory carries persons, organizations,
and the matter-party bridge; the File Manager carries immutable versions behind a quarantine gate;
the matters numbering engine carries the counter-plus-allocation idiom a firm-scoped custody number
needs; shipping carries the physical-transport leg an offsite movement wants. The feature ledger
records `custodian` as `designed` with the evidence line "no code", and the matter-detail skeleton
already reserves a Custodian section (`apps/web/src/lib/matters/sections.ts`) with nothing behind it.

Two obligations from earlier slices come due here rather than being invented here. The Locations
model reserved the custody hierarchy as its named consumer and stated that a Location referenced by a
custody record is closed, never hard-deleted — this slice is the first code that makes that sentence
enforceable. ADR-0049 built the deleted-file destruction machinery with "blocked by any
legal/discovery/**Custodian** hold" written into it against a hold surface that does not yet exist;
this slice creates the first real Custodian hold.

## 1. What the prior brainstorm settled, and what this spec changes

[`2026-06-16-safe-custody-design.md`](2026-06-16-safe-custody-design.md) is a brainstorm, not a
settled design — its own status line says so. It is treated as input and evaluated rather than
inherited.

**Kept, because the reasoning holds.** The MVP-first framing (ship a durable register with no
machinery that needs ongoing upkeep, leave the workflow-engine seams in place). The recursive
container tree rooted at a Location. The append-only custody log. Mandatory owner linkage as the
structural defence against orphaned originals. The intrinsic-value flag as the seam destruction logic
later reads. Deferring the will-on-death statutory engine and its per-state catalog entirely, on the
grounds that a jurisdiction catalog is a standing maintenance obligation and encoding one from
memory is worse than not having it. The reuse map (Locations, Directory, Matters, R2 scans, the
retention engine, Notifications). The competitive reading: safe custody is a near-uncontested US
white space because the mature products region-gate it or ship a two-level list.

**Changed or added, with reasons.**

1. **A packet/item hierarchy, not a flat item list.** The brainstorm modeled a single `Item` sitting
   directly in a container. Every product that has shipped this feature — LEAP, Actionstep,
   Smokeball, triSearch, Konekta — models a **packet** that holds **documents/items**, because that
   is the physical reality: a firm holds one envelope for the Smith family containing a will, two
   codicils, and a deed, and it is the envelope that moves. Section 3 makes the packet the unit of
   custody and the item the unit of description. This is not cosmetic: it decides what a movement row
   points at.
2. **The movement ledger is a real append-only table with database triggers, not "the immutable-log
   house pattern" as a gesture.** Section 5 specifies it against the `conflicts_*` migration's
   trigger idiom, which is what "append-only" means in this tree.
3. **Firm-scoped custody numbers.** The brainstorm did not identify custody identity as a problem.
   It is one — a custody register is read aloud over the phone and written on a physical label — and
   the matters allocation-ledger idiom is already built for exactly this race (section 6).
4. **The scan-binding problem is named and solved.** The brainstorm said "attach R2 scans to an item"
   without noticing that `file.matter_id` is `NOT NULL` and a custody owner may have no matter at
   all. Section 7 resolves it; this is the sharpest structural question in the subsystem.
5. **A borrower is a first-class field on a check-out, and a due-back date exists from day one.** The
   brainstorm deferred named-borrower tracking to a later slice. The _column_ is deferred at no cost
   only if it is deferred as a column, and it is not — a check-out with no borrower is a record that
   does not answer the question the register exists to answer. Recording who has it is free; _gating_
   the release on identity and authority is the expensive part, and that stays deferred (section 9).
6. **Locations rather than a free-text site.** The brainstorm rooted the tree at a Location, which is
   right, but did not address the bank vault or the offsite storage vendor — neither of which is a
   firm office. Section 4 settles this without adding a second location entity.
7. **Discarded: "co-ownership form (joint tenancy / tenancy-in-common) captured now because it
   determines release authority later."** It is captured, but not as an enum this design invents.
   Tenancy forms are jurisdiction-specific, unevenly named, and the design has no release-authority
   engine to consume them; inventing a closed vocabulary now fixes the wrong thing in schema. Section
   3 records ownership _form_ as a firm-configurable label on the owner link instead, which is the
   same data with none of the false precision. Flagged as owner decision C5.
8. **Discarded: the retention-defaults table.** The brainstorm listed "per-item-type retention
   defaults" as spec-time work. This design refuses to ship default retention periods for original
   wills and deeds — see section 9 and owner decision C7. Retention periods for client property are
   the single most jurisdiction-bound fact in this subsystem, they differ between the ABA model rule
   and Texas, New York, Illinois, California and Florida, and the guidance that matters most says
   original documents of intrinsic value sit _outside_ the routine clock entirely. A wrong default
   here destroys an irreplaceable original.

## 2. What ships, and what does not

The whole subsystem is a register plus a ledger plus a set of seams. The slice split follows what a
firm can use on day one versus what carries a standing maintenance obligation.

| Slice     | Ships                                                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **4·2·1** | The register: locations tree, packets and items, owner and depositor links, the optional matter link, custody numbers, the movement ledger with check-out/check-in and borrower, scanned-copy binding, holds. |
| **4·2·2** | Review dates and the reminder emission seam; the destruction request/approval workflow behind the hold gate; labels and barcodes; the register reports (per owner, per location, per due-back).               |
| **4·2·3** | Gated release (identity and authority logged before an item leaves), signed deposit and release receipts through document automation, and portal visibility of "items we hold for you".                       |
| **4·2·4** | Scan-to-locate and stocktake reconciliation over the container tree; the will-on-death statutory deadline engine and its jurisdiction catalog; the succession/transfer manifest.                              |

**Non-goals, named so they are not re-derived.**

_The firm's own asset register._ Equipment, depreciation, insurance schedules. A different duty
(firm property, not client property) with a different audience. Possibly a future cousin; not this
subsystem, and deliberately not a "type" on the same table, because every access and reporting
question about client property has a different answer for firm property.

_Evidence and exhibit custody for litigation._ Discovery owns chain-of-custody over produced
material, and its defensibility model (per-document hashing, content-addressed storage, Bates) is
already specified there. A physical exhibit a firm holds _is_ a custody item and belongs here; the
digital production chain does not.

_A jurisdiction catalog of will-deposit statutes._ Deferred entirely to 4·2·4, and even there it is
gated on owner decision C8. State will-deposit statutes carry real teeth and real variance —
Florida's deposit-within-ten-days-of-death, California's thirty days with liability for all damages,
Texas's enforcement by arrest of a non-complying custodian — and they are exactly the kind of fact
that must be verified against primary text at build time rather than encoded from memory. A catalog
that is 90% right is worse than no catalog, because it will be trusted. Until it exists, the
subsystem offers a generic review-date reminder and says nothing about statutory deadlines.

_Safe-deposit-box banking integration._ A bank vault is a location (section 4). Talking to a bank is
not in scope for any slice.

_Insurance valuation and appraisal tracking._ A declared value on an item is a field (section 3); an
appraisal workflow with revaluation cycles is a different product.

## 3. The custody model

### 3.1 Packet and item

**A packet is the unit of custody. An item is the unit of description.**

A **`custody_packet`** is the physical thing the firm holds and moves: an envelope, a deed box, a
sealed wallet, a single large item held loose. It carries the firm-scoped custody number, the current
location, the current status, the owner links, the depositor, the optional matter link, and the
review date. A movement always moves a packet.

A **`custody_item`** is one thing inside a packet: "original will of Jane Smith dated 14 March 2019",
"share certificate, 200 ordinary, Acme Holdings", "front-door key". It carries a type, a description,
the intrinsic-value flag, an optional declared value, an optional dated reference (the instrument's
own date, which is what a firm actually searches by for a will), and its own status.

Why the split, stated plainly because a flat model is the tempting simplification: the register
answers two different questions with two different grains. "Where is the Smith packet" is a location
question about a physical object that moves as one unit. "Do we hold an original will for Jane Smith"
is a content question about something that never moves independently of its packet. Collapsing them
forces one of the two to be wrong — either every item carries a redundant location that can drift out
of agreement with its siblings, or the register cannot describe what is in the envelope. Every
shipped product in this category has landed on the same split, which is corroboration rather than
proof but is worth noticing.

**A packet may hold zero items.** A newly logged packet whose contents have not yet been itemized is
a real state a firm passes through, and refusing it means the register loses to a sticky note.

**An item never moves between packets by an edit.** Re-packeting is a movement of the item recorded
in the ledger (section 5), not an `UPDATE` of `custody_item.packet_id` — the question "when did the
will move out of the family envelope and into the deed box" has to have an answer.

**Nesting is a location concern, not an item concern.** A packet inside a deed box inside a safe is
expressed by the location tree (section 4), not by packets containing packets. One nesting mechanism,
not two.

### 3.2 What a packet may contain — the type catalog

Item types are a **per-firm catalog table**, not an enum: `custody_item_type`, following the shipped
`document_type` / `matter_type` shape exactly (name, optional code, `active` flag, soft-deactivate,
unique name). The subsystem seeds a starting set on provisioning — original will, codicil, deed,
power of attorney, trust instrument, share or stock certificate, bearer security, title document,
promissory note, birth or marriage certificate, passport, jewelry or valuable, keys, sealed
instructions, storage media, other — and a firm adds to it. This is a registry-first decision of the
same kind the platform makes everywhere: a growing list of similar things is a declaration, not code,
and a firm that holds something we did not think of must not be blocked.

Two flags on the item are deliberately _not_ derived from the type, because deriving them would be a
guess the firm cannot override:

- **`intrinsic_value`** — this original is irreplaceable. Set by a human, defaulted from the type's
  own `intrinsic_value_default`, always overridable. This flag is the one the destruction path reads
  (section 9), so it must be a fact a person asserted about _this_ object.
- **`declared_value_amount_minor`** plus a currency — optional, for insurance and for the firm's own
  risk picture. Money is `amount_minor` through `@magna-carta/money`, never a float; the platform's
  rule binds here as everywhere.

### 3.3 Ownership — the mandatory Directory link, and why it is mandatory

**A packet cannot exist without at least one owner link to a Directory entity.** This is the
subsystem's structural invariant, and it is enforced as a precondition in the write path rather than
as a `NOT NULL` (an owner is a row in a child table, so the constraint is "at least one", which
SQLite cannot express as a column check).

The reason is the failure mode the register exists to prevent. The catastrophic outcome in safe
custody is not a misplaced packet — it is an unattributable one: a sealed envelope in a safe with a
name on it that matches nobody in the system, held for a firm nobody remembers, whose owner cannot be
contacted and which therefore can never be released and never be destroyed. Orphan prevention has to
be structural, because a reminder is not a mechanism.

**`custody_owner`** — a link row: `packet_id`, `entity_id` (a `directoryPerson_` or
`directoryOrganization_` handle, following the `matter_party` precedent of an id column with no
cross-domain foreign key), an `ownership_role` (see below), and temporal columns so an ownership
change is a new row rather than an overwrite. Multiple owners are ordinary — a joint will packet has
two.

**The owner is a Directory entity, not a client and not a matter party.** This is the load-bearing
choice, and it is what the incumbents get wrong or get right by accident. Smokeball registers safe
custody on **contacts, not matters**, and that is correct: a firm holds a will for a client whose
last matter closed eleven years ago, for the adult child of a client, for a deceased client's estate,
for someone who has never had a matter at all. Rooting custody at the matter would make every one of
those cases either impossible or a fake matter. The Directory is the firm's single register of
people and organizations and is the only anchor that survives a matter closing.

**`ownership_role`** replaces the brainstorm's co-ownership enum. It is a short firm-configurable
label on the link — owner, joint owner, life tenant, trustee, executor, personal representative,
custodian-of-record — carried as free text validated against a per-firm catalog, not a closed
platform enum. The reasoning is in section 1, item 7: this design has no release-authority engine to
consume a tenancy form, so encoding one is false precision in schema that a later engine would have
to migrate away from. Owner decision C5.

**The depositor is separate from the owner and is not necessarily either.** `depositor_entity_id`
plus `deposited_at` on the packet: the person who physically handed the envelope over. It is
routinely a different person (a son deposits his mother's will), routinely a former colleague at
another firm (a bulk transfer on a practice closure), and it is a fact about the deposit event that
must not be overwritten when ownership changes. Nullable, because a packet inherited in a firm merger
may genuinely have no known depositor — and recording "unknown" honestly is better than recording a
guess.

### 3.4 The matter link is optional, and this is the whole point

`matter_id` on the packet is **nullable** and references `matter.id`. When set, the packet appears on
the matter's Custodian section (the reserved slot in the matter detail skeleton) and the matter's
close path can surface "this matter has originals in custody" as information. When unset — which is
the common steady state for a will held for a former client — the packet is reachable through its
owner, its number, and the register views, and nothing about it is diminished.

**Closing a matter never touches a custody packet.** The matter close-precondition registry
(`packages/matters/src/close-preconditions.ts`) is the obvious place to hang "you still hold
originals for this matter", and this design deliberately does _not_ register a blocking precondition
there. Holding a client's will after their matter closes is the normal, correct, indefinite state of
affairs; blocking a close on it would train firms to unlink packets to get past the gate, which
destroys exactly the linkage the register is for. Whether an _advisory_ (non-blocking) close-time
notice is worth building is owner decision C6.

### 3.5 Status, and what it is not

`custody_packet.status`: `held` · `out` · `released` · `destroyed` · `lost`.

`custody_item.status`: `held` · `out` · `released` · `destroyed` · `lost` · `superseded`.

Four notes on this small enum, because status fields drift into workflow engines:

- **Status is derived state maintained by the ledger, not an independently editable field.** Every
  transition is written in the same atomic batch as the movement row that caused it (section 5).
  There is no route that sets a status directly.
- **`out` is a packet-level state and an item-level state, and they are not the same event.** A whole
  packet can be checked out to a lawyer's office; a single item can be withdrawn from a packet and
  released to its owner while the packet stays in the safe.
- **`superseded` exists only on items.** A will replaced by a later will is not destroyed, released,
  or lost — it is superseded, and firms hold both. Without this state a firm records the truth
  incorrectly or not at all.
- **`lost` is a first-class recordable state.** A register that cannot record "we cannot find this"
  is a register that will be quietly falsified when the worst thing happens, at exactly the moment
  accurate records matter most. Recording a loss writes a movement row with a reason and is
  irreversible except by a later `found` movement — it is never edited away.

### 3.6 Custom fields

`custom_field.target` is currently `matter | entity`. A firm will want custody-specific fields (a
bank's box number, an insurance policy reference, a client's own filing code). Widening the target
enum to include `custodyPacket` is a one-value additive change to a shipped engine plus a migration,
and it is the reuse-before-building answer — the alternative is a second key/value system inside
Custodian, which is exactly the drift generator the platform avoids elsewhere. The widening lands in
4·2·1 so the seam is not retrofitted, with the same handle-not-name binding discipline the engine
already enforces.

## 4. The location model

### 4.1 One recursive tree, rooted at a Location

**`custody_location`** — a self-referencing tree: `id`, `name`, `kind`, `parent_location_id`
(nullable), `firm_location_id` (nullable), `status` (`active` / `closed`), `notes`, timestamps.

A **root node** has `parent_location_id IS NULL`. Every other node points at its parent. Depth is
unconstrained by schema and bounded by a write-path check (owner decision C4 fixes the number; the
recommendation is a hard cap around eight, which is far past any real storage arrangement and is
there to stop a cycle-free but absurd tree from turning a breadcrumb read into a pathological walk).

`kind` is a small vocabulary that exists to drive iconography and grouping, not behaviour:
`office` · `room` · `safe` · `cabinet` · `shelf` · `box` · `position` · `offsite` · `bank`. Nothing
in the engine branches on it. The white paper's canonical shape — Location (office) → safe → box →
position — is the _default_ a firm gets seeded, not the schema.

**Cycle prevention is a write-path check plus a depth cap, not a trigger.** Re-parenting a node walks
to the root and refuses if it meets itself. This is the same shape as the folder tree's constraints
and needs no new machinery.

### 4.2 The bank vault problem, and why `firm_location_id` is nullable

A firm's originals are not all in a firm office. They are in a bank safe-deposit box, at an offsite
records-storage vendor, or with a co-trustee. None of those is a `location` row — the Locations model
is explicit that a Location is "one of the firm's physical offices", it carries letterhead and
remit-to and a matter-number segment, and staff are assigned to it. Creating a Location for
"First National Bank, Box 2214" would corrupt the office list, the letterhead picker, and the
per-office reporting dimension for every other subsystem that reads it.

So: **a custody root node optionally binds to a firm Location through `firm_location_id`.** A root
bound to a Location is an office root — that is the white paper's "rooted at a Location", and it is
what makes "which office physically holds this original" answerable for a multi-office practice. A
root with `firm_location_id IS NULL` and `kind` of `offsite` or `bank` is an external custody site,
carrying its own name and an optional address, and it participates in the tree identically.

This satisfies ADR-0068 exactly rather than by force: Location stays a view and reporting dimension
inside the firm, and Custodian gains the external sites it genuinely needs without minting a second
office entity or overloading the first.

**A Location referenced by a custody root is closed, never hard-deleted** — the sentence the
Locations model already carries, made enforceable here for the first time. The reciprocal obligation
lands in this slice: `@magna-carta/locations`' close path gains a custody-reference check, so closing
an office with custody roots under it is an explicit, warned action rather than a silent orphaning.

### 4.3 Capacity is out of scope, and the seam is not built

A safe holds a finite number of deed boxes, and asking the register to know that is a natural
request. It is refused for this slice and no column is reserved, which is a deliberate departure from
the build-when-in-the-area default.

The reason is that capacity is not one fact. It is a count for a pigeonhole rack, a volume for a
safe, a weight limit for a shelf, and a contractual box allowance for a bank — and a schema that
picks one is wrong for the other three. There is no cheap correct column to add now, so adding a
wrong one is not a seam, it is a liability. If capacity is ever built it is a typed constraint per
location kind with its own design, and it costs one additive table at that point. What _is_ built now
and does most of the work: a location's current occupancy is a count the register can always compute,
and the reports in 4·2·2 surface it.

## 5. The movement ledger

### 5.1 The invariant

**A movement is appended, never updated and never deleted.** This is the subsystem's second
structural invariant, and it is enforced three ways, matching the `conflicts_*` precedent exactly
rather than inventing a fourth pattern:

1. `BEFORE UPDATE` and `BEFORE DELETE` triggers on `custody_movement` that `RAISE(ABORT)`.
2. A `BEFORE INSERT … WHEN EXISTS` trigger that refuses an `INSERT OR REPLACE` masquerading as an
   insert.
3. A source-scan fitness function rejecting any `UPDATE` or `DELETE` statement naming the table.

Triggers are not modelable in drizzle-kit, so the migration is hand-written raw SQL — the same
constraint the Directory FTS5 and conflicts migrations already live with.

The reason this is a hard invariant and not a convention: the register's entire value in a dispute is
that it is a contemporaneous record. "The packet was checked out to Ms. Alvarez on 3 March and
returned on 11 March" is worth something because nobody could have made it say otherwise afterwards.
A correction is a new compensating row (`kind: 'correction'` carrying `corrects_movement_id` and a
reason), never an edit — the same discipline the financial ledger applies to a mis-posted entry, and
borrowed here for the same reason.

### 5.2 The row

**`custody_movement`** — `id`, `packet_id`, nullable `item_id` (set when the movement concerns one
item rather than the whole packet), `kind`, `occurred_at`, `recorded_at`, `recorded_by_user_id`,
`from_location_id`, `to_location_id`, `borrower_*` (below), `due_back_on`, `reason`,
`corrects_movement_id`, `shipment_id`, and `note`.

`kind` — a closed set, because unlike item types this vocabulary is the subsystem's own state
machine: `logged` · `itemized` · `moved` · `checked_out` · `returned` · `withdrawn` · `released` ·
`superseded` · `destroyed` · `lost` · `found` · `hold_placed` · `hold_released` · `correction`.

Two columns deserve their reasoning stated:

**`occurred_at` and `recorded_at` are separate.** Custody events happen in the physical world and get
typed into the system afterwards — sometimes days afterwards, sometimes on a Monday for a Friday.
Collapsing them makes back-dating either impossible or indistinguishable from falsification. Both are
recorded; `occurred_at` is what the register displays and reports on, `recorded_at` is what proves
when the assertion was made, and a movement whose `occurred_at` precedes its `recorded_at` by an
unusual margin is a thing a reviewer can see.

**`shipment_id` binds a movement to the shipping subsystem.** Moving originals to an offsite site or
returning a deed to a client by courier is a physical transport with a carrier, a tracking code, a
signature-on-delivery option and an insured value — and all of that is _already built_
(`@magna-carta/shipping`, the `shipment` / `shipment_label` / `tracking_event` tables, certified mail
and return receipt and signature as canonical options). A custody movement therefore _references_ a
shipment rather than growing its own tracking fields. Two things follow that make this reuse honest
rather than nominal: the shipment's `matter_ref` is already nullable, so a matterless custody
shipment is a supported shape today; and the movement row is written when the packet leaves,
independently of whether the shipment is later delivered, so a carrier failure is visible as a
custody event and not only as a tracking status. The custody status does not derive itself from
carrier tracking — a package marked delivered is not proof the recipient is the right person.

### 5.3 Borrower

A check-out records **who has it**: `borrower_kind` (`member` / `entity` / `external`),
`borrower_user_id` (a firm member), `borrower_entity_id` (a Directory person or organization), or
`borrower_name` for a genuinely external individual with no Directory record — plus `due_back_on`.

The three-way shape exists because all three really occur: a partner takes the deed to a completion
meeting (member), the client's accountant collects a share certificate (entity), a courier's named
driver signs for it (external). Forcing an external borrower into the Directory would pollute the
conflicts corpus with people who are not parties to anything — the Directory is the conflicts corpus,
and writing a courier into it has a real downstream cost. Forcing them into a free-text field when a
Directory record exists loses the link. Recording which of the three it is makes both correct.

**`due_back_on` from day one.** An overdue check-out is _the_ operational signal a custody register
produces, the query is trivial once the column exists, and retrofitting it means every check-out
recorded before the retrofit is permanently silent. The reminder that fires on it is 4·2·2 (section
10); the column and the "overdue" read are 4·2·1.

**Recording is not gating.** A check-out in 4·2·1 is frictionless — it records, it does not block.
Gated release, where an item cannot leave until identity and authority are captured and a receipt is
generated, is 4·2·3 and is where the real compliance value is. The seam is already here: gating adds
a precondition to a write path that already writes the borrower.

### 5.4 Holds

**`custody_hold`** — `id`, `packet_id`, nullable `item_id`, `kind` (`legal` / `discovery` /
`client_instruction` / `dispute` / `unclaimed`), `placed_at`, `placed_by`, `reason`, `released_at`,
`released_by`. A hold is placed and released; the placement and release each also write a movement
row, so the ledger remains the complete story.

**A hold blocks destruction and release. It does not block a location move.** The distinction is
practical: a held item still has to be movable to a fireproof safe or an offsite site. What a hold
forbids is the item leaving the firm's custody or ceasing to exist.

This table is the concrete Custodian hold ADR-0049 wrote its destruction blocker against, and the
first slice makes that reference real: the file destruction path gains a Custodian-hold arm, so a
scanned copy bound to a held packet cannot be destroyed by a retention sweep. `unclaimed` is a hold
kind rather than a status because "we cannot locate the owner" is exactly a do-not-destroy condition
with logged contact attempts, and modelling it as a hold means it inherits the blocker for free.

## 6. Custody numbering

**A packet number is drawn at creation, frozen at assignment, and unique per firm.** It is what a
person writes on a physical label, reads over the phone, and searches by, so it is a real identifier
and not a display of the opaque handle.

**The mechanism is the matters allocation-ledger idiom, reused, not re-derived.** The matters
numbering engine already solved this exact race — concurrent draws against a per-firm counter with no
interactive transaction available — and the solution is documented, tested, and carries an ADR
(ADR-0079). Custodian reuses the shape:

```
read next_value
  -> render the number
  -> compose ONE batch:
       [ ensure-counter-row INSERT … ON CONFLICT DO NOTHING,
         guarded UPDATE … WHERE scope_key = ? AND next_value = ?,
         the packet INSERT,
         allocation INSERT (scope_key, drawn_value) ]
  -> a UNIQUE violation on the allocation primary key is the losing draw; bounded retry re-reads
```

Two tables — `custody_number_counter` and `custody_number_allocation` — mirroring
`matter_number_counter` / `matter_number_allocation` in shape and in the reason each exists. The
allocation table, not the unique index on the rendered string, is the load-bearing backstop, for the
same reason it is in matters: a scheme with a variable non-scoping segment renders different strings
from the same counter value, so only a claim on the _value_ catches the race.

**Where Custodian deliberately diverges from matters: the scheme is simpler.** Matter numbering is a
full segment-template engine because firms have strong, established, court-visible conventions about
matter numbers. Custody numbers have no such weight. This design ships a **fixed shape** — an
optional firm prefix, an optional location code, and a zero-padded sequence — configured through the
scoped-settings mechanism rather than a new scheme table and a new editor. If a firm needs the full
template engine here, extracting the matters renderer into a shared module is a later, small change;
building a second template engine now would be building the same thing twice on speculation.

**Scope is firm-wide by default, with per-root scoping as a setting.** A firm running two offices may
want `RNO-00042` and `LVS-00042` to coexist, which is exactly what the `scope_key` mechanism does.
The default is firm-wide, because a globally unique custody number is easier to say over the phone
and impossible to confuse.

**Item numbers are packet-relative** — `CUS-00042-3` — derived from an ordinal within the packet
rather than drawn from a counter. An item's identity is only meaningful inside its packet, and a
second global counter would buy nothing.

**A manually assigned number is supported and touches no counter.** A firm migrating from LEAP or
from a paper deeds register has thirty years of existing packet numbers on physical labels, and
forcing a renumber would mean re-labelling a safe. A manual number takes the unique index and gets no
allocation row, exactly as a manual matter number does.

## 7. Scanned copies — binding into the file pipeline

### 7.1 The problem, stated because it is the one that gets fudged

A custody packet wants scanned copies of what it holds. The File Manager is the platform's only
storage of record for uploaded bytes, and it is the right home — versions, hashes, quarantine,
preview, conversion, tiering, and holds all already work there. But **`file.matter_id` is
`NOT NULL`**, and a custody packet's owner may have no matter at all. That is the whole point of
section 3.4.

Three options, and the choice matters because it decides whether a firm can scan a will for a former
client.

**(a) Relax `file.matter_id` to nullable.** Rejected. It would touch the quarantine gate, every
matter-scoped read and index in the File Manager, the access model, and every consumer that assumes a
file has a matter — for one consumer's convenience. This is the same call the document-automation
design made for templates and it should be made the same way.

**(b) A parallel `custody_scan` table mirroring `file`/`file_version`.** Rejected here, though it was
right for templates. A template is firm-authored content used as an assembly input; a custody scan is
an ordinary client document that a firm will absolutely want to preview inline, convert, search,
bundle into a download, and put under a legal hold. Duplicating the File Manager for it means
duplicating six subsystems' worth of consumer behaviour, and the second copy is the one that will lag.

**(c) A custody-scan link table over ordinary `file` rows, with the matter requirement satisfied
honestly — recommended.** `custody_scan` is a link: `packet_id`, nullable `item_id`, `file_id`,
`kind` (`scan` / `photograph` / `receipt` / `appraisal` / `correspondence`), `captured_at`,
`captured_by`. The file itself is an ordinary File Manager file, ingested through the ordinary
presigned-upload and quarantine chokepoint with no bypass, previewable and convertible and holdable
like any other document.

The matter question is then answered by _where the file is filed_, and it has two legitimate answers:

- **The packet is matter-linked** — the file is filed on that matter, in a folder the subsystem names
  (default `Custody`). This is the common case for a live conveyancing or probate file and needs
  nothing new.
- **The packet is not matter-linked** — the file is filed on the firm's **custody holding matter**, a
  single per-firm system matter provisioned with the firm and marked `system` so it never appears in
  matter lists, reports, conflicts, or billing.

The holding matter is an honest answer rather than a trick, and it is worth defending explicitly: it
keeps one storage of record, one quarantine gate, one hold mechanism, and one set of consumer
behaviours, at the cost of one system row per firm and a `system` flag the matter list already has
every reason to grow. The alternative — a nullable matter id — buys the same outcome by weakening an
invariant that seven other subsystems depend on. Owner decision C3 covers whether the holding-matter
approach or a nullable-matter relaxation is preferred, because it is a schema-shape decision with a
long tail and it deserves an explicit answer.

### 7.2 What a scan is not

**A scan is never a substitute for the original, and the register never implies it is.** The item's
`intrinsic_value` flag governs destruction (section 9) and is completely independent of whether a
scan exists. "We have a scan" is precisely the reasoning that destroys an original will, and the
design refuses to let a scan satisfy any gate.

**Scans inherit the packet's holds.** A hold on the packet blocks destruction of the linked files
through the hold arm added in section 5.4.

## 8. Confidentiality, personally identifiable information, and access

**The register is a list of the most sensitive things a firm holds, and its metadata alone is
sensitive.** "This firm holds an original will for Jane Smith" is a disclosure even with no document
attached. Three consequences:

- **The three new person-referencing tables — `custody_packet` (depositor), `custody_owner` (owner
  entity), `custody_movement` (borrower entity and borrower name) — are classified in the
  personally-identifiable-information registry in the same change that creates them**, with the
  coverage fitness function forcing it. `custody_owner` and the packet's depositor reference resolve
  to a Directory entity and take `retain-under-matter` semantics on the same reasoning `matter_party`
  does: the fact that the firm holds property for a person is itself a record it must keep. The
  movement ledger is append-only, so its subject references are `pseudonymize-keep`, never deleted —
  the same treatment the registry gives every other append-only row. `custody_movement.borrower_name`
  is a value-keyed subject key, following the precedent ADR-0200 set for frozen email addresses:
  keying only on the entity id would leave exactly the external borrowers — the people with no
  Directory record — unreachable by erasure.
- **No item description, packet name, owner name, borrower, custody number, or location name is ever
  a telemetry dimension or a log field.** Section 10 states what is.
- **Access is firm-wide by default, matching the platform's open-by-default posture**, with the
  per-location separation reserved as the same seam ADR-0068 already reserves. Custodian does not
  invent a narrower model; if a firm needs one, it arrives as the platform-wide Location access gate,
  not as a Custodian-only exception.

**A declared value is not `protected()`.** It is a business number about an object, not an identifier
about a person, and the `protected()` chokepoint's cost — a permission check and an audit row per
read — is the right price for a Social Security number and the wrong price for "this ring is worth
$4,000" displayed in a list of forty items. If a firm ever needs sealed valuations, that is a
`protected()` column added later at the ordinary cost, and it is worth noticing now that the register
has no such column today. Owner decision C9.

## 9. Review, retention, and destruction — the seam, and only the seam

**This section defines a mechanism and deliberately supplies no policy.**

### 9.1 What ships

**Review dates.** `review_on` on a packet and optionally on an item, plus `review_interval_months`
for a recurring cycle. A review is not a deadline; it is "look at this again", which is what a firm
actually needs for an envelope it has held for nine years. The reminder that fires on it is 4·2·2 and
is emitted through the Notifications registry when that lands, with the emission point defined now so
it is a wiring change rather than a redesign (section 10).

**A destruction request workflow, gated but empty of policy.** `custody_destruction_request` —
`packet_id`, nullable `item_id`, `requested_by`, `requested_at`, `basis` (free text — the reason and
authority the requester asserts), `approved_by`, `approved_at`, `executed_at`, `outcome`. Destruction
is a two-person action by construction (requester and approver must differ), it is refused outright
while any hold is in force, and it is **refused outright on any item flagged `intrinsic_value`** with
no override in the API at all.

That last refusal is the one hard policy this design does encode, and it encodes it because it is not
jurisdictional: no jurisdiction's rules produce "destroy the client's original will because a
retention timer expired". Every source consulted — the ABA model rule's professional-fiduciary
standard, the Law Society's guidance on wills and probate files, state bar and malpractice-carrier
loss-prevention material — converges on originals of intrinsic value being returned to the client or
kept, never routinely destroyed. Encoding a refusal with no override is therefore encoding a
consensus, not a jurisdiction. Overriding it requires clearing the flag, which is a deliberate,
audited, human act on a specific object.

### 9.2 What does not ship, and is flagged rather than invented

**No retention periods. No jurisdiction catalog. No automatic destruction sweep. No statutory
deadline clock.**

Retention for client property is the most jurisdiction-bound fact in this subsystem and the research
is unambiguous that it varies materially: the ABA model and Texas default around five years, New York
and Illinois around seven, Ontario's guidance runs to fifteen against its ultimate limitation period,
and at least one professional liability fund recommends ten — while the guidance that governs _this_
subsystem's actual content says originals of intrinsic value sit outside the routine clock entirely
and are returned or kept indefinitely. A platform default here is a platform _opinion_ about when to
destroy a client's irreplaceable property.

So the seams exist and the numbers do not. `retention_until` is a nullable column a firm sets per
packet or item; there is no default, no derived value, and no code path that computes one. A
destruction sweep is not built. When the jurisdiction catalog is built (4·2·4, gated on owner
decision C8) it follows the trust-rules catalog pattern — jurisdiction-keyed reference data, verified
against primary text at build time, shipped one jurisdiction at a time with an explicit "not encoded
for your jurisdiction" state for the rest, never a silent generic fallback.

**Flagged as jurisdiction-specific and therefore owner or catalog decisions, not this design's:**
retention periods by item type and jurisdiction; will-deposit and lodgement deadlines on death;
whether the original goes to a court or to a personal representative; what authority document
suffices to release (letters testamentary, letters of administration, a power of attorney and the
fact that a power of attorney dies with its grantor); whether two signatories are required to release
an original; unclaimed-property and escheat treatment; and whether a firm must notify a client before
destroying anything. Each is real, each varies, and each is a fact the owner or a verified catalog
supplies — never a default this spec invents.

## 10. The API surface and telemetry

### 10.1 Permissions and resource binding

**Two permissions**, registered in `@magna-carta/access-control` and seeded by migration:

- **`custody:read`** — read the register, its locations, packets, items, movements, and scans.
  Seeded to the practising roles.
- **`custody:manage`** — create and edit packets, items, locations, and the type catalog; record
  movements; place and release holds; request and approve destruction. Seeded to the roles a firm
  trusts with physical originals.

Two rather than one because reading a register and moving originals in it are genuinely different
capabilities — a billing clerk answering "do we hold the deed" needs the first and must not have the
second. Two rather than four (a separate `custody:destroy`, a separate `custody:configure`) because
destruction is already gated by a two-person workflow plus the hold and intrinsic-value refusals, and
a permission key that adds no gate the workflow does not already impose is a key that will be seeded
carelessly. Owner decision C10 covers whether destruction approval warrants its own key.

**Resource binding: `custody:*` binds `resource: "firm"`.** This is a deliberate call against the
`files:*` precedent, and the reason is section 3.4: a custody packet's tenancy root is the firm, not
a matter, because a packet may have no matter by construction. Binding to `"matter"` would name a
resource half the rows do not have — the same reasoning that made the firm catch-all capture address
the documented exception in the `emails:*` row of the namespace map. `RESOURCE_BY_PERMISSION_NAMESPACE`
gains one row: `custody: "firm"`.

### 10.2 Routes

Code-as-contract per the API conventions: `createRoute` blocks with Zod schemas for every status,
`RouteMeta` on every route, all of it through the one chokepoint. Lists are cursor-paginated
`{ data, nextCursor }`.

| Route                                                     | Permission       | Resource | Audited | Idempotency | Notes                                                                  |
| --------------------------------------------------------- | ---------------- | -------- | ------- | ----------- | ---------------------------------------------------------------------- |
| `GET /api/v1/custody/locations`                           | `custody:read`   | firm     | no      | none        | The tree, flat with parent ids; the client assembles it.               |
| `POST /api/v1/custody/locations`                          | `custody:manage` | firm     | yes     | required    | Create a node; cycle and depth checks in the write path.               |
| `PATCH /api/v1/custody/locations/{locationId}`            | `custody:manage` | firm     | yes     | optional    | Rename, re-parent, close. Close refuses while occupied.                |
| `GET /api/v1/custody/packets`                             | `custody:read`   | firm     | no      | none        | Filter by owner entity, matter, location subtree, status, overdue.     |
| `POST /api/v1/custody/packets`                            | `custody:manage` | firm     | yes     | required    | Draws the custody number; refuses with no owner link.                  |
| `GET /api/v1/custody/packets/{packetId}`                  | `custody:read`   | firm     | no      | none        | Packet, items, owners, current location path, holds.                   |
| `PATCH /api/v1/custody/packets/{packetId}`                | `custody:manage` | firm     | yes     | optional    | Descriptive fields only — never status, never location.                |
| `POST /api/v1/custody/packets/{packetId}/items`           | `custody:manage` | firm     | yes     | required    | Add an item; writes an `itemized` movement.                            |
| `PATCH /api/v1/custody/packets/{packetId}/items/{itemId}` | `custody:manage` | firm     | yes     | optional    | Descriptive fields only.                                               |
| `POST /api/v1/custody/packets/{packetId}/owners`          | `custody:manage` | firm     | yes     | required    | Add an owner link; removal is temporal, never a delete.                |
| `POST /api/v1/custody/packets/{packetId}/movements`       | `custody:manage` | firm     | yes     | required    | **The one write path for every state change.** Appends; never updates. |
| `GET /api/v1/custody/packets/{packetId}/movements`        | `custody:read`   | firm     | no      | none        | The full ledger for a packet, newest first.                            |
| `POST /api/v1/custody/packets/{packetId}/holds`           | `custody:manage` | firm     | yes     | required    | Place a hold; also appends a `hold_placed` movement.                   |
| `POST /api/v1/custody/holds/{holdId}/release`             | `custody:manage` | firm     | yes     | required    | Release; appends `hold_released`.                                      |
| `POST /api/v1/custody/packets/{packetId}/scans`           | `custody:manage` | firm     | yes     | required    | Link an already-ingested `file` to the packet or an item.              |
| `GET /api/v1/custody/item-types`                          | `custody:read`   | firm     | no      | none        | The per-firm catalog.                                                  |
| `POST /api/v1/custody/item-types`                         | `custody:manage` | firm     | yes     | optional    | Add a type; deactivate, never delete.                                  |
| `POST /api/v1/custody/destruction-requests`               | `custody:manage` | firm     | yes     | required    | Refused under any hold or on an `intrinsic_value` item. 4·2·2.         |
| `POST /api/v1/custody/destruction-requests/{id}/approve`  | `custody:manage` | firm     | yes     | required    | Approver must differ from requester. 4·2·2.                            |

**The movement route is the only state-change path, and this is the design's central API decision.**
There is no check-out route, no check-in route, no move route, no "mark lost" route. All of them are
`POST /movements` with a `kind`, which means: one place enforces the append-only invariant, one place
writes the derived status in the same atomic batch, one place composes the `audit_log` row, and a new
movement kind is a schema-enum addition rather than a new route with its own subtly different
transaction. Idempotency is **required** on it because a retried check-out must not produce two
ledger rows.

Uploading scan bytes has no Custodian route at all: it is the File Manager's existing presigned
upload, and `POST /scans` links the resulting `file` handle. One ingest chokepoint, no exceptions.

Problem types are additive registry entries: `custody-owner-required`,
`custody-hold-blocks-action`, `custody-intrinsic-value-not-destructible`,
`custody-location-cycle`, `custody-location-occupied`, `custody-number-exhausted`,
`custody-approver-must-differ`.

### 10.3 Telemetry

Per the telemetry catalogs, every event and counter is a declaration, and dimension values are
low-cardinality labels rather than content.

**Event** — `custody.movementRecorded`, fields `[kind, borrowerKind, hasShipment]`. No packet handle,
no custody number, no location name, no borrower, no description.

**Counters** —

- `custody.movements`, dimensions `[kind, outcome]` — the register's activity shape and where
  movement writes fail.
- `custody.packetsOverdue`, dimensions `[bucket]` — a periodic gauge of check-outs past `due_back_on`
  in coarse buckets (`0-7d`, `8-30d`, `31-90d`, `over-90d`). This is the operational signal the
  subsystem exists to produce, and a firm-level number is worth having in aggregate.
- `custody.holdBlocked`, dimensions `[action, holdKind]` — how often a hold stops something, which is
  the evidence that the blocker is load-bearing rather than theoretical.
- `custody.numberDraw`, dimensions `[outcome]` — draw contention, mirroring what the matters counter
  already teaches us to watch.

**A custody number is not a dimension**, for the same reason a merge-field key is not: it is
firm-defined, high-cardinality, and printed on a physical object that a person can be identified by.
`kind` and `bucket` are the dimensions; the object is not.

## 11. User-interface seams

The owner designs the interface; this spec defines only the backend contract it calls. Five seams,
named:

1. **The register** — search and filter across packets by owner, number, item type, location subtree,
   status, and overdue state. The primary surface.
2. **Packet detail** — items, owners, depositor, the current location breadcrumb, holds, scans, and
   the full movement history as a timeline.
3. **The location tree** — a browsable tree with occupancy counts, and the move target picker.
4. **Check-out and check-in** — the two flows a firm uses daily; both post one movement.
5. **The matter Custodian section** — the slot already reserved in the matter detail skeleton, showing
   the packets linked to that matter and offering to link an existing one.

Labels and barcodes (4·2·2) are a print surface over the same reads and are named here so the packet
and location identifiers are designed to be label-carrying from the start.

## 12. Load-profile fit

Per the accretion rule (ADR-0083), this slice extends the load-profile harness in-area with a
`custodian` volume profile rather than adding a bespoke benchmark.

**Expected volumes, and why they are unusual.** Custodian is a _small, deep, and old_ corpus, which
is the opposite of the platform's other subsystems. An established firm holds low thousands of
packets, a handful of items each, and one to two movements per packet per _year_ — but it holds them
for decades, so the movement ledger is the only table that grows without bound and the register is
routinely queried across twenty years of history. Volume is not the risk; unbounded history on a hot
read is.

**Measured operations**, added to the committed baseline:

- The register list filtered by owner entity across the full packet corpus.
- The register list filtered by location subtree — the recursive walk, which is the one read with a
  genuinely non-obvious plan.
- A packet detail read: packet plus items plus owners plus holds plus the current location path.
- The overdue check-out sweep across all open check-outs.
- A packet's movement history at the tail of the distribution (a packet with two hundred movements),
  keyset-paginated.
- A custody number draw under concurrency, exercising the allocation backstop the way the matters
  measurement already does.

The plan-scan check must show index walks, not scans, on all six. The subtree filter is the one to
watch: a naive recursive query over a deep tree is the N+1 this subsystem is most likely to grow, and
the answer is a materialized path or a closure on `custody_location` decided against the measurement,
not ahead of it.

**What must never be on the request hot path:** the recursive subtree expansion recomputed per row;
reminder evaluation; any read of scan bytes; and the destruction eligibility evaluation. The only
synchronous work is the paginated reads and the single-batch movement write.

## 13. Test strategy

The risk is concentrated in three places, and the strategy follows them rather than spreading evenly.

**The append-only invariant, tested at the database.** A direct `UPDATE` on `custody_movement` aborts;
a direct `DELETE` aborts; an `INSERT OR REPLACE` on an existing id aborts. These are migration tests
against a real SQLite database, not service tests, because the guarantee is the trigger's and a
service test proves only that the service did not try. Plus the source-scan fitness function.

**The status-derivation batch.** Every movement kind's effect on packet and item status, asserted as
a table: the movement row and the status change commit together or not at all, and a failed status
update rolls back the movement. D1 has no interactive transaction, so every read-then-write
precondition carries its predicate on the write too — the discipline the matters lifecycle already
documents, applied here to "a packet already `out` cannot be checked out again" and "a released
packet accepts no further movement except a correction".

**The number draw under concurrency.** The matters counter test is the model: concurrent draws yield
distinct numbers, the losing draw aborts on the allocation primary key, and the bounded retry
re-reads the advanced counter. A manual number touches no counter and gets no allocation row.

**Refusals, each with a test.** A packet created with no owner is refused. A location re-parented into
its own subtree is refused. A location closed while occupied is refused. Destruction of an
`intrinsic_value` item is refused with no override path in the API. Destruction under any hold is
refused. A destruction approved by its requester is refused. A scan linked to a file in another firm
is unreachable by construction (the firm-scoped data-access layer), asserted anyway.

**Worker integration under the Miniflare pool.** The chokepoint contract per route (401 / 403 /
404-not-403 for a deactivated member), idempotency on every mutating route including a retried
check-out producing exactly one movement, and the end-to-end path: create a location tree, create a
packet with an owner and no matter, itemize it, upload and link a scan, check it out with a due-back
date, see it appear in the overdue read, check it back in, and read a movement history that tells the
whole story in order.

**Fixtures.** A synthetic custody corpus in the load-profile generator, non-privileged and
programmatically built: a two-office tree with an offsite root, packets spread across owners with and
without matters, a long-tailed movement history, and a fraction under hold.

## 14. Owner decisions required

These are opinion-heavy, jurisdiction-heavy, or invariant-heavy and are not settled by this design.

| Flag    | Decision                                                                                                                                                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **C1**  | **Packet-and-item, or a flat item register?** Recommended: packet is the unit of custody, item the unit of description (section 3.1). It is what every shipped product converged on and it decides what a movement points at, so it is expensive to change later.  |
| **C2**  | **Is the Directory owner link genuinely mandatory?** Recommended: yes, enforced in the write path, no exception. This is the orphan-prevention invariant; an escape hatch for "log it now, attribute it later" would be used constantly and defeat it.             |
| **C3**  | **Scans for a matterless packet: a per-firm system holding matter (recommended), or relax `file.matter_id` to nullable?** A schema-shape call with a long tail across seven subsystems (section 7.1).                                                              |
| **C4**  | **The location tree depth cap.** Recommended: eight, as a write-path refusal. Not a correctness question, but it is user-visible and better fixed than discovered.                                                                                                 |
| **C5**  | **Ownership form: a firm-configurable role label (recommended) or a platform enum of tenancy forms?** Tenancy forms are jurisdiction-specific and there is no release-authority engine to consume them yet (section 3.3).                                          |
| **C6**  | **Should closing a matter surface an advisory notice when custody packets are linked to it?** Recommended: advisory only, never blocking (section 3.4). A blocking gate would train firms to unlink.                                                               |
| **C7**  | **Retention periods: does the platform ever ship defaults?** Recommended: never by default; a firm sets `retention_until` per packet or item, and a jurisdiction catalog supplies suggestions only when built and verified (section 9.2).                          |
| **C8**  | **Is the will-on-death statutory engine and its jurisdiction catalog wanted at all, and if so, which jurisdiction first?** It is a standing maintenance obligation on primary legal text, and it is the highest-value differentiator in the subsystem.             |
| **C9**  | **Should declared values be `protected()`?** Recommended: no — a valuation is a business number, not a personal identifier, and the per-read audit cost is wrong for a list view (section 8).                                                                      |
| **C10** | **Two permissions (`custody:read` / `custody:manage`), or a third for destruction approval?** Recommended: two, since destruction is already gated by a two-person workflow plus the hold and intrinsic-value refusals (section 10.1).                             |
| **C11** | **Does an item's movement out of a packet require the packet's owner set to be re-asserted?** Recommended: no — ownership is a packet-level fact and re-packeting does not change who owns the will. Worth an explicit answer because the alternative is arguable. |

## 15. Open questions

1. **The location subtree read shape.** A recursive common table expression, a materialized path, or
   a closure table. The answer is a measurement (section 12), not a preference, and it is the one
   structural decision this design deliberately leaves to the harness. All three are additive to the
   same `custody_location` row; only the index set differs.
2. **Whether the movement ledger should carry a per-row content hash.** The financial ledger does not,
   but a custody ledger is closer to an evidentiary record than an accounting one, and a hash chain
   would make tampering detectable rather than merely forbidden. It is cheap to add now and expensive
   to retrofit (every prior row would be outside the chain), which argues for deciding it in this
   slice rather than deferring it. Not recommended without a stated threat model — the triggers plus
   the audit log already cover the accidental and the careless cases, and a chain defends only against
   an actor with direct database access, which is a platform-level threat with a platform-level answer.
3. **Whether `custom_field.target` widening should be `custodyPacket` alone or `custodyPacket` plus
   `custodyItem`.** Two targets doubles the surface for a use case that may not exist; one target
   forces item-level firm data onto the packet. Belongs to the custom-fields area's judgement rather
   than a decision made here.
4. **Portal visibility granularity.** "Items we hold for you" is an obvious client-portal surface and
   an obvious way to leak the existence of a will to the wrong family member. It is 4·2·3 work, but
   the granularity question — per packet, per item, per owner link — should be settled before the
   portal grant model hardens rather than after.
5. **Bulk intake.** A firm merger or a practice closure arrives as a spreadsheet of two thousand
   packets and a van. The design supports it through ordinary writes, but whether it warrants a
   dedicated import path (with reconciliation against a successor-custodian manifest) is a question
   the first real migration answers, and it shares its shape with the deferred LEAP import.
