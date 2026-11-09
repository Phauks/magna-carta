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
- `src/release-gate.ts` — the release gate: what a `released` movement has to capture before an
  original leaves, and the only place that is decided
- `src/hold-service.ts` / `src/hold-statements.ts` — holds, and the blocker read a destruction path calls
- `src/destruction-service.ts` / `src/destruction-statements.ts` — the two-person destruction workflow:
  request → approve or refuse → execute, with the hold and intrinsic-value refusals at both ends
- `src/will-deposit-catalog.ts` — the jurisdiction-keyed will-deposit duty catalog (Nevada encoded);
  refuses rather than guesses, and holds no interpretation of what it quotes
- `src/close-advisory.ts` — the matter-close notice: informational, never a refusal
- `src/settings.ts` — the firm's release policy and its ownership-role catalog, both read by hand
- `src/scan-service.ts` — links an already-ingested `file` to a packet; resolves the filing matter
- `src/numbering/` — the packet-relative item number (`render.ts`), and a thin shim binding
  custody's tables and `packet_id` owner column to the shared draw in
  `@magna-carta/sequence-numbering`. The custody number's SHAPE is not here: it is the
  `custody_packet` purpose on that package's numbering register (CUS-00001 by default), written by
  the firm on the one numbering settings screen and read by the shared draw planner in
  `packet-service.ts`
- `src/queries.ts` — the register list, the location-subtree filter, and the overdue check-out sweep
- `src/review-service.ts` / `src/review-statements.ts` — review dates: completing one, the
  anniversary-anchored roll forward, and the reviews-due read
- `src/reminders.ts` — **the reminder emission point**: the one place a due review and an overdue
  check-out are decided, in one shape
- `src/reports.ts` — the register reports: holdings per owner, occupancy per location, holds in force
- `src/stocktake-service.ts` / `src/stocktake-statements.ts` / `src/stocktake-reconciliation.ts` —
  the physical count: open, record observations, close. **Observe-only** — see the invariant below
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
- **An original does not leave without identity and authority on the row.** A `released` movement
  must name who collected the property and carry the authority the release is made on, how the
  collector was identified, and the member who made that check — `resolveCustodyReleaseCapture` in
  `src/release-gate.ts` is the only place that is decided, and it runs before the identifier is minted
  so a refused release writes nothing at all. Release is the one movement this subsystem gates,
  because it is the only one that is irreversible from the firm's side; the daily check-out stays
  frictionless on purpose, since friction on the movement a firm records daily is how a register
  stops being kept.
- **No authority vocabulary, ever.** What document suffices to release an original — a grant of
  probate, letters of administration, a power of attorney and the fact that one dies with its grantor
  — is jurisdiction-specific. The basis is free text the firm writes, on the same footing as the
  ownership role and the destruction basis; nothing here parses it, matches it against a list, or
  decides whether it is good enough.
- **Every read-then-write precondition rides the write too.** D1 has no interactive transaction, so
  `recordCustodyMovement` composes `assertCustodyPacketStatusStatement` (and its item twin) FIRST in
  the batch: it re-inserts the row's own primary key when the status is not what the caller observed,
  aborting the whole batch. A guarded `UPDATE` alone would silently match zero rows.
- **Destroying property takes two people, and they are two people at the database.** The requester and
  the approver differ, enforced by `custody_destruction_request_two_person_insert` / `_update` on top
  of the column CHECK — the CHECK cannot see that a NULL requester makes any approver satisfy it, and
  a trigger can. Execution additionally requires a committed `approved` outcome, so an approval cannot
  arrive in the same statement that carries the destruction out, and a refused/executed/withdrawn
  request is frozen. Execution appends its `destroyed` entry through `recordCustodyMovement`, never a
  parallel write, and commits the ledger row BEFORE the request's completion: a destruction with no
  ledger entry is a destruction nobody can prove, while a request stuck at `approved` after a recorded
  destruction is visible and correctable.
- **An item flagged `intrinsic_value` is never destructible, and the refusal has no override.** No
  parameter, no flag, no privileged caller, no second endpoint. It is enforced in
  `destruction-service.ts`, in `movement-service.ts` (the workflow is not the only way to append a
  `destroyed` movement), and by triggers on both `custody_destruction_request` and `custody_movement`,
  so it holds for a write path nobody has written. A packet-scoped destruction is refused when ANY
  item in it carries the flag. The only way past is a person clearing the flag on that object — a
  change to a fact, not a route round a rule.
- **The jurisdiction catalog refuses rather than guesses, and two refusals stay distinct.**
  `custody-jurisdiction-not-recorded` (nobody said which law) and `custody-jurisdiction-not-encoded`
  (nobody has verified that law) are fixed differently and must never be conflated or defaulted. A
  sub-jurisdiction key refuses on its own terms even where its parent is encoded — resolving an
  unchecked county to its state's entries would answer "the county requires nothing". The catalog
  carries verbatim statutory text with its citation and no interpretation of it; a question the
  sources leave open stays open, and a due date is computed only from a date a person recorded.
- **The matter-close notice is an advisory and can never become a refusal.** `close-advisory.ts`
  implements `CloseAdvisory` (a `notice`), never `ClosePrecondition` (a `check` plus a `commitGuard`).
  Custody must not block a matter close: a firm holds a client's will for decades after their last
  matter closed, and a block would only teach firms to unlink packets before closing. The notice
  carries a COUNT and nothing identifying — closing a matter needs no custody permission.
- **No retention defaults, ever.** No column carries a default retention and no code path derives one;
  the purity test fails on any identifier that looks like it does. Retention for client property is
  the most jurisdiction-bound fact in this subsystem, and a platform default is a platform opinion
  about when to destroy a client's irreplaceable property. A **review date is not a retention clock**
  — nothing expires when one passes, and the only consequence is that the object appears on a list.
- **A stocktake observes and reports; it never writes the register.** The `stocktake-*` modules write
  `custody_stocktake` and `custody_stocktake_sighting` and nothing else — no movement, no packet, no
  item, no status, no review roll. A count's entire value is the difference between what the register
  claims and what is on the shelf, so a count that wrote the register into agreement with itself would
  erase that difference at the moment of finding it, and would append a ledger row no person asserted.
  The reconciliation names the corrective movement as a PROPOSAL; a person records it through
  `recordCustodyMovement` or does not. A missing packet proposes nothing at all — an empty shelf is an
  investigation, not a reason to close the record on it. `test/purity.test.ts` scans the stocktake
  sources (comments stripped) for a register mutation, a status/location setter, a ledger insert, and
  any destruction path, so the boundary holds against a call site nobody has written yet.
- **A sighting is append-only, exactly as a movement is.** `custody_stocktake_sighting` carries the
  same three triggers plus a fourth refusing an observation against a stocktake that is no longer
  open. It is a named person's assertion about a physical object on a day; a correction is the later,
  truer observation and both stay on the record. `test/append-only.test.ts` proves all four.
- **No money as a float.** A declared value is `declared_value_amount_minor` plus a currency, and the
  schema refuses one without the other.
- **Nothing identifying is a telemetry dimension or an audit-metadata field.** No custody number, no
  packet or location name, no owner, borrower, or item description. The register is a list of the most
  sensitive things a firm holds and its metadata alone is a disclosure.

## Dependencies & contracts

- Depends on `@magna-carta/data-access`, `@magna-carta/database`, `@magna-carta/identifiers`,
  `@magna-carta/money`, `@magna-carta/sequence-numbering` (the custody-number draw), and
  `@magna-carta/matters` (only for `system-matter-statements` — the custody holding matter). It does NOT depend on `@magna-carta/locations`, `@magna-carta/directory`, or
  `@magna-carta/file-manager`: a firm office, a Directory entity, and a stored file all arrive as
  handles, following the `matter_party` precedent of an id column with no cross-domain foreign key.
- The route layer (`apps/api-worker/src/http/routes/custody/custody.ts`) hands every service the firm-scoped database,
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
- **The release gate is a TRIGGER, not a CHECK, and that is the load-bearing part.** Adding a CHECK
  means rebuilding `custody_movement` and copying every existing row through it — and every release
  recorded before the gate existed was recorded honestly under the rules that then applied, carrying
  no capture. Making those rows pass would mean writing a basis nobody asserted into a ledger whose
  only claim is that nobody could do exactly that. `20260805T130000_custody-gated-release.sql` adds
  three `BEFORE INSERT` triggers instead, so the gate binds every row appended from here on and
  leaves history alone. `test/append-only.test.ts` proves all three at the database and asserts that a
  pre-gate release still reads back as it was written.
- **Identity capture is an assertion about the check, not a copy of the document.** The evidence
  column records what was checked. The row is append-only, so a passport number typed there can never
  be edited out — and nothing the register does needs it. The API description and the user guide both
  say so, because this is the field a firm will otherwise fill with a photocopy in words.
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
