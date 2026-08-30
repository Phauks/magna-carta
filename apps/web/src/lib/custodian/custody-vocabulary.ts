/*
 * The register's words: every status, hold, movement and borrower value the Custodian surfaces
 * render, given its label, its tone and what it means on hover.
 *
 * THE WORDS ARE THE DOMAIN'S, TAKEN VERBATIM. `held`, `out`, `released`, `destroyed`, `lost`,
 * `superseded`, the fourteen movement kinds, the five hold kinds and the three borrower kinds are
 * declared in packages/custodian/src/types.ts, which is the state machine the ledger derives from.
 * Nothing here invents a synonym, softens a word, or collapses two of them: `superseded` is not
 * `released`, `lost` is a first-class recordable state and not an absence, and a register that
 * renamed either would be describing something the record does not say.
 *
 * WHERE THIS BELONGS. The one home for a status word's label, tone and meaning is the design
 * system's status register (packages/design-system/src/lib/status-register/status-register.ts),
 * whose whole point is that a word carries the same tone wherever it appears. It holds no custody
 * vocabulary yet, and this stream does not own that package — so the vocabulary is declared here in
 * the register's own `StatusEntry` shape, one place for the whole subsystem, and moving it is a
 * relocation rather than a rewrite. Nothing else in these surfaces decides a tone.
 *
 * The tone choices follow the register's own reading of its palette: neutral for a resting fact,
 * warning for something a person has to act on, danger for an irreversible end state, info for a
 * standing condition, success for property safely back where it belongs.
 */
import type { StatusEntry } from "@magna-carta/design-system/status-register";

/** A packet's status — the physical thing the firm holds and moves. */
export type CustodyPacketStatus = "held" | "out" | "released" | "destroyed" | "lost";

/** An item's status. `superseded` exists only here: a will replaced by a later will is neither. */
export type CustodyItemStatus = CustodyPacketStatus | "superseded";

/** Every state change the register records, through its one movement write path. */
export type CustodyMovementKind =
  | "logged"
  | "itemized"
  | "moved"
  | "checked_out"
  | "returned"
  | "withdrawn"
  | "released"
  | "superseded"
  | "destroyed"
  | "lost"
  | "found"
  | "reviewed"
  | "hold_placed"
  | "hold_released"
  | "correction";

/** Why property is held back from leaving or ceasing to exist. */
export type CustodyHoldKind =
  | "legal"
  | "discovery"
  | "client_instruction"
  | "dispute"
  | "unclaimed";

/** Who has it, when it is out. All three shapes really occur. */
export type CustodyBorrowerKind = "member" | "entity" | "external";

/** A node of the container tree. Drives grouping and reading only; nothing branches on it. */
export type CustodyLocationKind =
  | "office"
  | "room"
  | "safe"
  | "cabinet"
  | "shelf"
  | "box"
  | "position"
  | "offsite"
  | "bank";

const ITEM_STATUS_REGISTER: Readonly<Record<CustodyItemStatus, StatusEntry>> = {
  held: {
    label: "Held",
    tone: "neutral",
    meaning: "In the firm's safekeeping, at the location the register names.",
    presentation: "chip",
  },
  out: {
    label: "Out",
    tone: "warning",
    meaning: "Checked out. The ledger names who has it and when it is due back.",
    presentation: "chip",
  },
  released: {
    label: "Released",
    tone: "info",
    meaning: "Handed back. The ledger records the authority it left on and who collected it.",
    presentation: "chip",
  },
  destroyed: {
    label: "Destroyed",
    tone: "danger",
    meaning: "Destroyed after a request and a separate approval. It does not come back.",
    presentation: "chip",
  },
  lost: {
    label: "Lost",
    tone: "danger",
    meaning: "Recorded as not found. It stays on the record until somebody records finding it.",
    presentation: "chip",
  },
  superseded: {
    label: "Superseded",
    tone: "neutral",
    meaning: "Replaced by a later instrument. The firm still holds it.",
    presentation: "chip",
  },
};

/** One packet status, as the register renders it. */
export function packetStatusEntry(status: CustodyPacketStatus): StatusEntry {
  return ITEM_STATUS_REGISTER[status];
}

/** One item status, as the register renders it. */
export function itemStatusEntry(status: CustodyItemStatus): StatusEntry {
  return ITEM_STATUS_REGISTER[status];
}

/** The packet statuses in reading order — what a filter offers and a legend lists. */
export const PACKET_STATUSES: readonly CustodyPacketStatus[] = [
  "held",
  "out",
  "released",
  "destroyed",
  "lost",
];

/**
 * What a movement kind reads as in a history.
 *
 * Written as the completed act rather than the enum, because a chain of custody is read as a
 * sentence: "Checked out", "Returned", "Recorded as lost". `correction` is deliberately not
 * softened — a compensating row is the only way this ledger is ever put right, and a reader has to
 * be able to see one.
 */
const MOVEMENT_LABELS: Readonly<Record<CustodyMovementKind, string>> = {
  logged: "Logged into the register",
  itemized: "Contents described",
  moved: "Moved",
  checked_out: "Checked out",
  returned: "Returned",
  withdrawn: "Withdrawn from the packet",
  released: "Released",
  superseded: "Superseded",
  destroyed: "Destroyed",
  lost: "Recorded as lost",
  found: "Found",
  reviewed: "Reviewed",
  hold_placed: "Hold placed",
  hold_released: "Hold released",
  correction: "Correction",
};

/** How one recorded movement reads. */
export function movementLabel(kind: CustodyMovementKind): string {
  return MOVEMENT_LABELS[kind];
}

const HOLD_LABELS: Readonly<Record<CustodyHoldKind, string>> = {
  legal: "Legal hold",
  discovery: "Discovery hold",
  client_instruction: "Client instruction",
  dispute: "Dispute",
  unclaimed: "Unclaimed",
};

/** How one hold reads. */
export function holdLabel(kind: CustodyHoldKind): string {
  return HOLD_LABELS[kind];
}

/**
 * What a hold in force means, for the hover.
 *
 * Every one of them says the same two things, because the domain says the same two things: the
 * property may not leave and may not cease to exist, and it may still be moved somewhere safer.
 */
export function holdMeaning(kind: CustodyHoldKind): string {
  return `${HOLD_LABELS[kind]}: this property cannot be released or destroyed while the hold stands. It can still be moved.`;
}

const BORROWER_LABELS: Readonly<Record<CustodyBorrowerKind, string>> = {
  member: "A member of the firm",
  entity: "Someone in the directory",
  external: "A named individual",
};

/** What kind of person has it. */
export function borrowerKindLabel(kind: CustodyBorrowerKind): string {
  return BORROWER_LABELS[kind];
}

const LOCATION_LABELS: Readonly<Record<CustodyLocationKind, string>> = {
  office: "Office",
  room: "Room",
  safe: "Safe",
  cabinet: "Cabinet",
  shelf: "Shelf",
  box: "Box",
  position: "Position",
  offsite: "Offsite store",
  bank: "Bank",
};

/** What kind of container a node is. */
export function locationKindLabel(kind: CustodyLocationKind): string {
  return LOCATION_LABELS[kind];
}

/**
 * The overdue buckets the register reports in, in reading order. The words are the domain's own
 * bucket keys; only their rendering is decided here.
 */
export const OVERDUE_BUCKETS: readonly { key: string; label: string }[] = [
  { key: "0-7d", label: "Up to a week" },
  { key: "8-30d", label: "One to four weeks" },
  { key: "31-90d", label: "One to three months" },
  { key: "over-90d", label: "Over three months" },
];

/** How an overdue bucket reads, or the raw key where a new bucket arrives before this list does. */
export function overdueBucketLabel(bucket: string): string {
  return OVERDUE_BUCKETS.find((entry) => entry.key === bucket)?.label ?? bucket;
}
