# Custodian register model — packet over item, owner at the Directory, one append-only movement path

**Status:** Proposed
**Date:** 2026-08-04
**Area:** Custodian

## Context

ADR-0014 accepted Custodian as "location hierarchy + custody log + labels + scans + reminders" and
left the shape of each open. Four questions had to be settled before any schema: what the unit of
custody is, what a custody record is anchored to, how a state change is written, and where a scanned
copy lives when the platform's only file storage requires a matter and a custody owner may have none.

A firm holds an original will for a client whose last matter closed eleven years ago, for the adult
child of a client, and for a deceased client's estate. It holds them in an envelope containing
several documents, and it is the envelope that physically moves. The register's value in a dispute is
that it is a contemporaneous record nobody could have altered afterwards.

## Decision

**A packet is the unit of custody; an item is the unit of description.** `custody_packet` carries the
number, the location, the status, the owners, the depositor, and the optional matter link; a movement
always moves a packet. `custody_item` describes one thing inside it — type, description, the
intrinsic-value flag, an optional declared value — and never moves between packets by an edit. Item
types are a per-firm catalog table following the shipped `document_type` shape, not a platform enum.
Nesting is expressed by the location tree, never by packets containing packets.

**Ownership anchors at a Directory entity and is mandatory.** At least one `custody_owner` link is
required at creation, enforced in the write path. The matter link is nullable and the depositor is a
separate, separately-nullable reference. The catastrophic outcome in safe custody is not a misplaced
packet but an unattributable one — a sealed envelope nobody can attribute, release, or destroy — so
orphan prevention is structural rather than a reminder. This also matches how the one shipped US-market
product in the category registers custody: on contacts, not matters.

**One recursive location tree, rooted optionally at a firm Location.** `custody_location` is
self-referencing with a nullable `firm_location_id`: a root bound to a Location is an office root; a
root of kind `offsite` or `bank` is an external custody site. A bank vault is not a firm office and
must not become a `location` row, which carries letterhead, remit-to, a matter-number segment, and
staff assignment. Cycle prevention and a depth cap are write-path checks. **Capacity is out of scope
with no column reserved** — it is a count, a volume, a weight, and a contractual allowance depending
on the node, and a schema that picks one is wrong for the other three.

**`POST /movements` is the only state-change path, and the ledger is append-only.** No check-out
route, no check-in route, no move route, no mark-lost route: all of them are one movement kind. One
place enforces the invariant, writes the derived status in the same atomic batch, and composes the
audit row. Append-only is enforced by `BEFORE UPDATE` / `BEFORE DELETE` / replace-guard triggers (the
conflicts migration's idiom), plus a source-scan fitness function. A correction is a new compensating
row carrying `corrects_movement_id`, never an edit. `occurred_at` and `recorded_at` are separate
columns so back-dating is supported and visible rather than indistinguishable from falsification.

**Custody numbers reuse the matters allocation-ledger idiom** — ensure-row, guarded increment, packet
write, allocation claim, bounded retry — with a fixed number shape rather than a second
segment-template engine. **Scanned copies are ordinary File Manager files** linked through a
`custody_scan` row; a matterless packet files onto a per-firm `system` holding matter rather than
relaxing `file.matter_id`.

## Considered options

**A flat item register with a location on every item** — rejected. The register answers a location
question about an object that moves as one unit and a content question about something that never
moves independently; collapsing them forces either a redundant location that can drift out of
agreement across siblings, or a register that cannot describe what is in the envelope.

**Anchoring custody at the matter** — rejected. It makes a will held for a former client either
impossible or a fake matter, and it loses the record the moment a matter closes.

**A tenancy-form enum (joint tenancy / tenancy-in-common) on the owner link** — rejected for now.
Tenancy forms are jurisdiction-specific and unevenly named, and there is no release-authority engine
to consume them; a firm-configurable ownership-role label carries the same data with none of the
false precision, and a later engine is not migrating away from an invented vocabulary.

**Per-transition routes (check-out, check-in, move)** — rejected. Each would be a second place the
append-only invariant and the status-derivation batch have to be enforced, and the second one is the
one that will be wrong.

**Relaxing `file.matter_id` to nullable for custody scans** — rejected in favour of a system holding
matter. The relaxation touches the quarantine gate, every matter-scoped read and index, and every
consumer that assumes a file has a matter, for one consumer's convenience. A parallel `custody_scan`
table mirroring `file`/`file_version` was also rejected: unlike a document template, a custody scan is
an ordinary client document a firm will want to preview, convert, search, bundle, and hold, so
duplicating the File Manager for it means duplicating six subsystems' worth of consumer behaviour.

## Consequences

**Positive.** A movement history is a record that cannot be quietly rewritten, which is the only
property that makes it worth anything in a dispute. Orphaned originals are impossible by
construction. A multi-office firm can answer "which office holds this" without an office list
polluted by bank vaults. The number draw inherits a race-proof idiom that is already tested. Scans
inherit preview, conversion, search, tiering, and holds for free, and the hold table becomes the
first real consumer of the destruction blocker the deleted-file lifecycle was written against.

**Negative.** A `system` matter per firm is a row that exists for an internal reason and needs
excluding from every matter list, report, conflicts run, and billing path — a small, permanent tax
paid to keep one storage of record. The append-only ledger cannot be pruned, so a twenty-year packet
carries every row it ever generated. Capacity has no seam, so building it later costs a design rather
than a column.

**Open.** Whether the movement ledger should carry a per-row content hash is deliberately left
undecided: the triggers plus the audit log already cover the accidental and careless cases, and a
hash chain defends only against direct database access, which is a platform-level threat with a
platform-level answer. It is cheap now and expensive later, which is why it is flagged rather than
silently deferred.
