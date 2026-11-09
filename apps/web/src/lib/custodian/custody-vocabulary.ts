/*
 * The register's words: every status, hold, movement and borrower value the Custodian surfaces
 * render, given its label, its tone and what it means on hover.
 *
 * THE WORDS ARE THE DOMAIN'S, TAKEN VERBATIM. `held`, `out`, `released`, `destroyed`, `lost`,
 * `superseded`, the fourteen movement kinds, the five hold kinds, the three borrower kinds and the
 * five scan kinds are declared in packages/custodian/src/types.ts, which is the state machine the
 * ledger derives from. Nothing here invents a synonym, softens a word, or collapses two of them:
 * `superseded` is not `released`, `lost` is a first-class recordable state and not an absence, and
 * a register that renamed either would be describing something the record does not say. Rendering
 * `out` as "On loan" is not an exception to that: it is the same state under the ledger's own noun
 * for the person who has it, and the pair it belongs to is what had to be legible. `out` and
 * `released` are the two states in which property is off the shelf, and they are opposites — a loan
 * is the firm's to get back, a release has ended the firm's custody — so a label that left them
 * reading as the same event was the defect. The ACT is still "Checked out", in the movement labels
 * below, because a history is read as a sentence about what somebody did.
 *
 * WHERE THE STATUSES LIVE. Not here. A status word's label, tone and meaning belong to the design
 * system's status register, whose whole point is that a word carries the same tone wherever it
 * appears — so the six custody statuses were moved into it and this module reads them back. What
 * stays below is deliberately everything that is NOT a status: movement kinds, hold kinds, borrower
 * kinds, location kinds. Those are taxonomies that happen to have labels, and a status register
 * that absorbed every labelled enumeration in the product would stop being about status.
 */
import { statusEntry, type StatusEntry } from "@magna-carta/design-system/status-register";

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

/** Who has it, when it is checked out. All three shapes really occur. */
export type CustodyBorrowerKind = "member" | "entity" | "external";

/** What a copy filed against a packet IS. A scan is never a substitute for the original. */
export type CustodyScanKind = "scan" | "photograph" | "receipt" | "appraisal" | "correspondence";

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

// The custody statuses now live in the design system's status register, where a word carries the
// same tone wherever it appears. This module keeps the label-only vocabularies below — movement
// kinds, hold kinds, borrower kinds, location kinds — because those are taxonomies rather than
// statuses, and a status register that absorbed them would stop being about status.

/** One packet status, as the register renders it. */
export function packetStatusEntry(status: CustodyPacketStatus): StatusEntry {
  return statusEntry(status);
}

/** One item status, as the register renders it. */
export function itemStatusEntry(status: CustodyItemStatus): StatusEntry {
  return statusEntry(status);
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

/*
 * The scan kinds, as a reader meets them. The enum was being printed raw against a packet's filed
 * copies, so a receipt read as `receipt` and a piece of correspondence as `correspondence`; a
 * taxonomy the register offers in a form is a taxonomy it has to be able to render back.
 */
const SCAN_LABELS: Readonly<Record<CustodyScanKind, string>> = {
  scan: "Scan",
  photograph: "Photograph",
  receipt: "Receipt",
  appraisal: "Appraisal",
  correspondence: "Correspondence",
};

/** How one filed copy reads. */
export function scanKindLabel(kind: CustodyScanKind): string {
  return SCAN_LABELS[kind];
}

/** The scan kinds in reading order — what the link form offers. */
export const SCAN_KINDS: readonly CustodyScanKind[] = [
  "scan",
  "photograph",
  "receipt",
  "appraisal",
  "correspondence",
];

/** Every kind a container can be, in the order a form offers them: largest to smallest, then the external sites. */
export const LOCATION_KINDS: readonly CustodyLocationKind[] = [
  "office",
  "room",
  "safe",
  "cabinet",
  "shelf",
  "box",
  "position",
  "offsite",
  "bank",
];

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
