---
category: Added
---

**Custodian — the safe-custody register (slice 4·2·1).** The second half of the Phase 4 deliverable
now has code behind it: a firm can build its physical container tree, log a packet owned by a
Directory entity with no matter, itemize it, link a scan, check it out to a named borrower with a
due-back date, see it turn up on the overdue list, check it back in, and read a history that tells the
whole story in order. The new `@magna-carta/custodian` package sits on the established
structure-versus-access seam — pure TypeScript, no binding, no clock, no `env` — and the whole surface
is nineteen routes through the one chokepoint.

**Eleven per-firm tables, and two structural invariants the schema and the write path defend
together.** `custody_location` is one recursive tree whose root either binds a firm office or stands
for an external site (a bank vault, an offsite records vendor) — a bank is not one of the firm's
offices, so it never becomes a `location` row and never pollutes the letterhead picker or the
per-office reporting dimension. `custody_packet` is the unit of custody and `custody_item` the unit of
description, with `custody_owner` as the temporal link to the Directory. **A packet cannot exist
without at least one owner link** — enforced on the one creation path, with no "log it now, attribute
it later" escape hatch, because the catastrophic outcome in safe custody is not a misplaced envelope
but an unattributable one, and ending the last current owner is refused for the same reason.

**The movement ledger is genuinely append-only.** `custody_movement` carries `BEFORE UPDATE`, `BEFORE
DELETE`, and a `BEFORE INSERT … WHEN EXISTS` replace-guard that each `RAISE(ABORT)`, proved by
migration tests that attempt all three against real SQLite; a source-scan fitness test refuses any
`UPDATE` or `DELETE` naming the table so the failure lands at review rather than at runtime. A
correction is a new compensating row that names the row it corrects — there is no edit path anywhere.
`occurred_at` and `recorded_at` are separate columns, so a Friday collection typed in on Monday is
recorded honestly instead of being indistinguishable from falsification.

**`POST /movements` is the only state-change path in the subsystem.** There is no check-out route, no
check-in route, no move route and no mark-lost route: every one is a movement kind, so a single place
enforces the append-only invariant, writes the derived packet or item status in the same atomic batch,
and composes the audit row. Because D1 has no interactive transaction, each movement composes a
precondition fence first — an insert that collides with the row's own primary key exactly when the
status is not what the caller observed — so a concurrent movement aborts the whole batch instead of
letting a guarded `UPDATE` match zero rows in silence. Borrower is three-way (firm member, Directory
entity, or an external name), and `due_back_on` ships now rather than later because an overdue
check-out is _the_ signal a custody register produces and a retrofitted column leaves every earlier
check-out permanently silent.

**Custody numbers reuse the matters allocation-ledger idiom** — ensure-row, guarded increment,
allocation claim on the drawn value, bounded retry — with a fixed number shape rather than a second
segment-template engine. Concurrent draws yield distinct sequential numbers; a manually assigned
number carried in from a paper deeds register touches no counter and takes no allocation row, so a
firm migrating thirty years of physical labels does not have to re-label a safe.

**Holds block release and destruction, and deliberately do not block a move** — a held original still
has to be movable to a fireproof safe. Placing and releasing each append a movement, so the ledger
stays the complete story, and `readActiveCustodyHoldsForFile` is the blocker read a hold-aware
destruction sweep calls: a scan bound to a held packet is not destroyable.

**Scanned copies are ordinary File Manager files.** There is no upload route in Custodian at all —
bytes ride the existing presigned-upload and quarantine chokepoint, and `custody_scan` links the
resulting handle, so a custody scan is previewable, convertible, searchable, and holdable like any
other document. The awkward part (`file.matter_id` is `NOT NULL`, and a custody owner may have no
matter) is answered by a per-firm **system holding matter**: `matter.system_key` marks it, a partial
unique index makes two concurrent first uses collapse onto one row, and `listMatters` excludes it —
rather than relaxing an invariant seven subsystems depend on.

**No retention policy ships, and that is the decision.** `custody_destruction_request` lands as a
schema seam with its two-person constraint checked at the database, but no retention period, no
default, no derived date, and no sweep — a purity test fails the build on anything that looks like
one. Retention for client property is the most jurisdiction-bound fact in the subsystem, and the
guidance governing originals of intrinsic value places them outside the routine clock entirely; a
platform default there is a platform opinion about when to destroy a client's irreplaceable property.

Two permissions, `custody:read` and `custody:manage`, both binding `resource: "firm"` — a deliberate
call against the `files:*` precedent, because a packet may have no matter by construction and binding
to `"matter"` would name a resource half the rows do not have. `custody:read` is seeded to every
default role (a billing clerk answering "do we hold the deed" needs it); `custody:manage` reaches only
the roles trusted with the safe. Telemetry declares one event and four counters in which no custody
number, packet handle, location name, borrower, or item description has a slot to exist in: the
register is a list of the most sensitive things a firm holds, and its metadata alone is a disclosure.

Deferred to later custodian slices: review dates and their reminders, the destruction workflow itself,
labels and barcodes, register reports, gated release and receipts, portal visibility, stocktake, and
the will-on-death jurisdiction engine.

Design: `docs/specs/2026-08-04-custodian-design.md`. User guide:
`docs/user/features/safe-custody-register.md`.
