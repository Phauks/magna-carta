// The Custodian vocabulary, in one place so the routes, the services, and the tests all name the
// same values. Item TYPES are deliberately not here — they are a per-firm catalog table, because a
// firm that holds something nobody thought of must not be blocked. Everything below is a closed set
// because it is the subsystem's own state machine, which is a different kind of list.

// A node of the container tree. This drives iconography and grouping only; nothing branches on it.
// `offsite` and `bank` are the external sites a firm's originals really live in — a bank vault is
// not one of the firm's offices and must never become a `location` row.
export const CUSTODY_LOCATION_KINDS = [
  "office",
  "room",
  "safe",
  "cabinet",
  "shelf",
  "box",
  "position",
  "offsite",
  "bank",
] as const;
export type CustodyLocationKind = (typeof CUSTODY_LOCATION_KINDS)[number];

export const CUSTODY_LOCATION_STATUSES = ["active", "closed"] as const;
export type CustodyLocationStatus = (typeof CUSTODY_LOCATION_STATUSES)[number];

// A location tree deeper than this is not a storage arrangement, it is a mistake — the cap exists so
// a cycle-free but absurd tree cannot turn a breadcrumb read into a pathological walk. Eight is far
// past office > room > safe > cabinet > shelf > box > position, the deepest real arrangement.
export const MAX_CUSTODY_LOCATION_DEPTH = 8;

export const CUSTODY_PACKET_STATUSES = ["held", "out", "released", "destroyed", "lost"] as const;
export type CustodyPacketStatus = (typeof CUSTODY_PACKET_STATUSES)[number];

// `superseded` exists only on an item: a will replaced by a later will is not destroyed, released,
// or lost, and firms hold both. Without the state a firm records the truth incorrectly or not at all.
export const CUSTODY_ITEM_STATUSES = [
  "held",
  "out",
  "released",
  "destroyed",
  "lost",
  "superseded",
] as const;
export type CustodyItemStatus = (typeof CUSTODY_ITEM_STATUSES)[number];

// Every state change in the subsystem is one of these, recorded through the single movement write
// path. `lost` is first-class on purpose: a register that cannot record "we cannot find this" is a
// register that will be quietly falsified at exactly the moment accurate records matter most.
export const CUSTODY_MOVEMENT_KINDS = [
  "logged",
  "itemized",
  "moved",
  "checked_out",
  "returned",
  "withdrawn",
  "released",
  "superseded",
  "destroyed",
  "lost",
  "found",
  // A completed review changes nothing about where the property is or what state it is in — it
  // records that a person looked at it, which is the only evidence "we last checked the Smith
  // envelope in March 2024" has. The ledger is this subsystem's only record that anything happened,
  // so a review that left no row would be a review nobody can prove.
  "reviewed",
  "hold_placed",
  "hold_released",
  "correction",
] as const;
export type CustodyMovementKind = (typeof CUSTODY_MOVEMENT_KINDS)[number];

// The longest recurring review cycle the schema accepts, in months — fifty years. It is a sanity
// bound on a typed number, not a policy: a firm choosing five years, ten, or twenty is choosing, and
// nothing here supplies a default interval or derives one from an item type.
export const MAX_CUSTODY_REVIEW_INTERVAL_MONTHS = 600;

// All three shapes really occur, and recording which one it is makes each correct: a partner takes
// the deed to a completion meeting (member), the client's accountant collects a share certificate
// (entity), a courier's named driver signs for it (external). An external borrower stays out of the
// Directory deliberately — the Directory is the conflicts corpus, and writing a courier into it has
// a real downstream cost.
export const CUSTODY_BORROWER_KINDS = ["member", "entity", "external"] as const;
export type CustodyBorrowerKind = (typeof CUSTODY_BORROWER_KINDS)[number];

export const CUSTODY_HOLD_KINDS = [
  "legal",
  "discovery",
  "client_instruction",
  "dispute",
  "unclaimed",
] as const;
export type CustodyHoldKind = (typeof CUSTODY_HOLD_KINDS)[number];

export const CUSTODY_SCAN_KINDS = [
  "scan",
  "photograph",
  "receipt",
  "appraisal",
  "correspondence",
] as const;
export type CustodyScanKind = (typeof CUSTODY_SCAN_KINDS)[number];

// Which movement kinds a hold refuses. A hold blocks the property leaving the firm's custody or
// ceasing to exist; it deliberately does NOT block a location move, because a held original still
// has to be movable to a fireproof safe or an offsite site.
export const HOLD_BLOCKED_MOVEMENT_KINDS: readonly CustodyMovementKind[] = [
  "released",
  "destroyed",
];

// The status a movement kind leaves on the record it names. A movement with no entry here (logged,
// itemized, moved, hold_placed, hold_released, correction) changes location or annotates history
// without changing status. `withdrawn` takes an item out of its packet, so it only ever applies to
// an item; `superseded` likewise.
export const PACKET_STATUS_BY_MOVEMENT_KIND: Partial<
  Record<CustodyMovementKind, CustodyPacketStatus>
> = {
  checked_out: "out",
  returned: "held",
  released: "released",
  destroyed: "destroyed",
  lost: "lost",
  found: "held",
};

export const ITEM_STATUS_BY_MOVEMENT_KIND: Partial<Record<CustodyMovementKind, CustodyItemStatus>> =
  {
    checked_out: "out",
    returned: "held",
    withdrawn: "out",
    released: "released",
    superseded: "superseded",
    destroyed: "destroyed",
    lost: "lost",
    found: "held",
  };

// A released, destroyed, or lost packet is a closed record. The one movement it still accepts is a
// correction (the ledger has no edit path, so a mis-recorded loss is fixed by a compensating row)
// and, for a loss, a `found` — because property does turn up, and the register has to be able to say
// so without falsifying the earlier entry.
export const TERMINAL_PACKET_STATUSES: readonly CustodyPacketStatus[] = [
  "released",
  "destroyed",
  "lost",
];

// ---- stocktake ----

// A count is open while people are walking the shelves, and closed when the reconciliation is drawn.
// `abandoned` is a real outcome rather than a tidy-up: a count begun and not finished must not close
// as though it had counted everything, because the reconciliation of a half-done count reads as a
// safe full of missing originals — the single most alarming and most wrong thing this subsystem
// could tell a firm.
export const CUSTODY_STOCKTAKE_STATUSES = ["open", "closed", "abandoned"] as const;
export type CustodyStocktakeStatus = (typeof CUSTODY_STOCKTAKE_STATUSES)[number];

// What one person recorded while counting. `not_found` is deliberately distinct from simply never
// being counted: "I went to the shelf the register named and it was not there" is a much stronger
// statement than "nobody reached that shelf", and collapsing the two would make an unfinished count
// indistinguishable from a loss. `unregistered` carries no packet handle at all — it is the
// unlabelled envelope on the shelf the register has no row for, which is the discrepancy a register
// cannot otherwise express.
export const CUSTODY_SIGHTING_KINDS = ["sighted", "not_found", "unregistered"] as const;
export type CustodySightingKind = (typeof CUSTODY_SIGHTING_KINDS)[number];

// The four ways a count can disagree with the register, plus the one way it can agree.
//
// `missing` — the register expected it in scope and nobody saw it.
// `misplaced` — somebody saw it, somewhere other than where the register said it was.
// `unexpected` — somebody saw it where the register did not expect it to be at all: the register has
//   it checked out, released, destroyed, or lost, so the shelf should have been empty.
// `unregistered` — somebody saw a physical object the register has no row for.
export const CUSTODY_RECONCILIATION_OUTCOMES = [
  "matched",
  "missing",
  "misplaced",
  "unexpected",
  "unregistered",
] as const;
export type CustodyReconciliationOutcome = (typeof CUSTODY_RECONCILIATION_OUTCOMES)[number];

// The movement a person would record to bring the register back into agreement with the shelf — a
// PROPOSAL, printed on the report and never written. A stocktake observes; it does not dispose,
// relocate, or correct. Writing the proposal automatically would put a movement in an append-only
// ledger that no person asserted, and would quietly erase the very difference the count exists to
// surface. Every proposal here is a movement kind that already exists, recorded by a person through
// the one movement write path in movement-service.ts or not at all.
//
// `missing` proposes nothing. The honest answer to "the will is not where we said it was" is an
// investigation, and a register that suggested recording a loss the moment a shelf came up empty
// would be teaching firms to close the record on the exact failure that most needs one open.
export const CUSTODY_PROPOSED_MOVEMENT_BY_OUTCOME: Partial<
  Record<CustodyReconciliationOutcome, CustodyMovementKind>
> = {
  misplaced: "moved",
  unexpected: "found",
};
