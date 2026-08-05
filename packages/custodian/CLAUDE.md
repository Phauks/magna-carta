# @magna-carta/custodian — CLAUDE.md

**Purpose.** The safe-custody register: the physical container tree, the packets a firm holds and the
items described inside them, mandatory Directory ownership, firm-scoped custody numbers, the
append-only movement ledger, holds, and the link from a packet to its scanned copies. Validates in
memory and composes statements into `@magna-carta/data-access`'s `composeEffectBatch`; holds no
binding, reads no clock, and never calls an external service.

**White paper:** _Custodian_, with _Locations_, _Directory_, and _Matters and File Manager_ as the
surrounding context — [`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
(ADR-0014, ADR-0068, ADR-0049.)
**Spec:** [`docs/specs/2026-08-04-custodian-design.md`](../../docs/specs/2026-08-04-custodian-design.md).

## Key files / entry points

- `src/types.ts` — the closed vocabularies (location kinds, statuses, movement kinds, borrower kinds,
  hold kinds) plus the movement-kind → status tables the ledger derives from
- `src/location-service.ts` — the container tree: create, rename, re-parent, close; cycle walk + depth cap
- `src/packet-service.ts` — `createCustodyPacket`, the central write: number draw, packet, owner links,
  and the opening ledger entry in one commit; plus the owner add/end pair
- `src/item-service.ts` — items and their intrinsic-value / declared-value fields
- `src/movement-service.ts` — **the one write path for every state change**
- `src/hold-service.ts` / `src/hold-statements.ts` — holds, and the blocker read a destruction path calls
- `src/scan-service.ts` — links an already-ingested `file` to a packet; resolves the filing matter
- `src/numbering/` — the counter + allocation statements and the fixed number shape
- `src/queries.ts` — the register list, the location-subtree filter, and the overdue check-out sweep
- `src/review-service.ts` / `src/review-statements.ts` — review dates: completing one, the
  anniversary-anchored roll forward, and the reviews-due read
- `src/reminders.ts` — **the reminder emission point**: the one place a due review and an overdue
  check-out are decided, in one shape
- `src/reports.ts` — the register reports: holdings per owner, occupancy per location, holds in force
- `src/label-service.ts` + `src/labels/` — printable label sheets, and the Code 128 encoder under them

## Invariants that apply here

- **A movement is appended, never updated and never deleted.** `custody_movement` carries BEFORE
  UPDATE / BEFORE DELETE / replace-guard triggers that `RAISE(ABORT)`, so an `UPDATE` or `DELETE`
  naming the table fails at runtime; `test/purity.test.ts` scans the source so it fails at review
  instead. A mistake is corrected by appending a `correction` row that names the row it corrects.
- **A packet cannot exist without at least one owner link.** "At least one" over a child table is not
  expressible as a SQLite column check, so `createCustodyPacket` enforces it and `endCustodyOwner`
  refuses to take the last current owner. There is deliberately no escape hatch: one that existed
  would be used constantly, and the whole point is that an original held for nobody the firm can name
  can never be released and never be destroyed.
- **Status is derived, never set.** Every status and location change is written in the same atomic
  batch as the movement that caused it. No service here exposes a status setter, and no route sets one.
- **Every read-then-write precondition rides the write too.** D1 has no interactive transaction, so
  `recordCustodyMovement` composes `assertCustodyPacketStatusStatement` (and its item twin) FIRST in
  the batch: it re-inserts the row's own primary key when the status is not what the caller observed,
  aborting the whole batch. A guarded `UPDATE` alone would silently match zero rows.
- **No retention defaults, ever.** No column carries a default retention and no code path derives one;
  the purity test fails on any identifier that looks like it does. Retention for client property is
  the most jurisdiction-bound fact in this subsystem, and a platform default is a platform opinion
  about when to destroy a client's irreplaceable property. A **review date is not a retention clock**
  — nothing expires when one passes, and the only consequence is that the object appears on a list.
- **No money as a float.** A declared value is `declared_value_amount_minor` plus a currency, and the
  schema refuses one without the other.
- **Nothing identifying is a telemetry dimension or an audit-metadata field.** No custody number, no
  packet or location name, no owner, borrower, or item description. The register is a list of the most
  sensitive things a firm holds and its metadata alone is a disclosure.

## Dependencies & contracts

- Depends on `@magna-carta/data-access`, `@magna-carta/database`, `@magna-carta/identifiers`,
  `@magna-carta/money`, and `@magna-carta/matters` (only for `system-matter-statements` — the custody
  holding matter). It does NOT depend on `@magna-carta/locations`, `@magna-carta/directory`, or
  `@magna-carta/file-manager`: a firm office, a Directory entity, and a stored file all arrive as
  handles, following the `matter_party` precedent of an id column with no cross-domain foreign key.
- The route layer (`apps/worker/src/routes/custody.ts`) hands every service the firm-scoped database,
  the real clock, a crypto random source, and the authenticated actor — none of which is client input.

## Gotchas

- **The stored idempotency body IS the wire body.** The chokepoint's idempotency gate replays the
  stored response verbatim, so `createCustodyPacket` and `recordCustodyMovement` store `{ id, … }`
  (the platform's created-resource shape) and rename it on the way out. A stored shape that differs
  from what the handler returns hands a retrying client a different payload than the original request.
- **A checked-out packet has no location.** `current_location_id` goes null on a check-out, release,
  destruction, or loss, because the shelf really is empty — occupancy counts and the close-refusal
  read depend on that being true.
- **A location's `firm_location_id` binds only on a root.** A child inherits its office from the root
  it hangs off; the schema check refuses a mid-tree node that claims one.
- **Scan bytes never come through here.** They ride the File Manager's presigned upload and quarantine
  chokepoint, onto the matter `resolveCustodyFilingMatter` names; `linkCustodyScan` only links the
  resulting handle, and refuses a file filed anywhere else.
- **Widening the movement vocabulary means rebuilding `custody_movement`.** The kind list is a CHECK
  constraint, and SQLite can only replace one by rebuilding the table — which is why
  `20260804T170001_custody-review-schedule.sql` drops the three append-only triggers, copies into a
  new table, and recreates them. It is safe only because the ledger carries **no referential
  dependency**: `corrects_movement_id` is a self-reference deliberately declared without a foreign
  key. Keep it that way, and re-prove the append-only triggers against the table that came out of any
  future rebuild — `test/append-only.test.ts` does exactly that.
- **A review rolls forward on its anniversary, not from today.** `nextReviewDate` steps whole
  intervals from the scheduled date until it lands past the review, so a five-year cycle reviewed
  eight months late stays on its anniversary instead of drifting a third of a year every cycle — and
  a review left a decade takes as many steps as it needs, so the answer is never already overdue.
- **There is one reminder emission point and it is a query, not a scheduler.**
  `collectCustodyReminders` is where both a due review and an overdue check-out are decided. No cron,
  no queue, no timer lives here. When the Notifications registry lands, delivery subscribes to that
  function rather than growing a second definition of what is due — two definitions would eventually
  disagree, and the one people act on would be whichever they saw last.
- **A label's barcode carries the identifier handle, never the custody number.** A number is
  firm-defined and re-renderable; the handle is the row. A label is a physical object that outlives
  every software change made after it was printed, so a scan must resolve through no lookup rule that
  can change under it.
- **The subtree read shape is provisional.** `selectCustodyLocationSubtreeStatement` is a recursive
  common table expression. A materialized path and a closure table are both additive to the same row
  and differ only in the index set, so the choice belongs to a measurement against the load-profile
  harness rather than to a preference — the walk is bounded meanwhile so a hand-introduced cycle
  truncates instead of hanging.
