/*
 * A matter's lifecycle status, as the product speaks it.
 *
 * THE WORDS ARE NOT THIS FILE'S. They come from the design system's status register, which is the
 * one place any status word in the product is given its label, its tone and its meaning. What lives
 * here is the one fact the register cannot know: how the matters contract SPELLS each state on the
 * wire. Those two are not the same, and pretending they were is what would put a storage spelling
 * in front of a reader.
 *
 * THE ONE PLACE THEY DIFFER, STATED PLAINLY. The firm's word for a matter it is working is ACTIVE.
 * The contract stores that state as `open` — the code the listing filters on, the code the create
 * request carries, the code the database column holds. So `open` is what crosses the wire and
 * "Active" is what prints, and this map is the only place the two meet. The pause is stored as
 * `hold` and prints as On Hold. Intake, Consultation and Closed spell the same both ways.
 *
 * CLOSED IS A REAL LIFECYCLE STATE AND NOT A CREATABLE ONE. The contract stores it, a matter
 * reaches it by being closed, and the docket must be able to filter for it whether or not the firm
 * has one today. The create operation, though, accepts only intake, consultation and open — so the
 * intake offers Closed as a state that exists and cannot yet be started in, rather than hiding a
 * word the firm uses.
 */
import { statusEntry, type StatusKey } from "@magna-carta/design-system/status-register";
import type { BadgeVariant } from "@magna-carta/design-system/badge";

/** The status codes the matters contract stores and filters on. */
export type MatterStatus = "intake" | "consultation" | "open" | "hold" | "closed";

/** Which word in the product's register each stored code speaks. */
const MATTER_STATUS_WORDS: Readonly<Record<MatterStatus, StatusKey>> = {
  intake: "intake",
  consultation: "consultation",
  open: "active",
  hold: "on-hold",
  closed: "closed",
};

export interface MatterStatusPresentation {
  /** The label as it prints, title case. */
  label: string;
  /** The subtle badge register this status wears. */
  variant: BadgeVariant;
  /** What the status means, for the hover. Never printed beneath the chip. */
  meaning: string;
}

/** How one status reads. */
export function matterStatusPresentation(status: MatterStatus): MatterStatusPresentation {
  const entry = statusEntry(MATTER_STATUS_WORDS[status]);
  return { label: entry.label, variant: entry.tone, meaning: entry.meaning };
}

/** The label alone — what a sort key, a filter value, or a cell's plain text needs. */
export function matterStatusLabel(status: MatterStatus): string {
  return statusEntry(MATTER_STATUS_WORDS[status]).label;
}

/**
 * The lifecycle statuses in the order a matter passes through them. Drives any control that offers
 * a status, so two surfaces cannot disagree about which comes first.
 */
export const MATTER_STATUSES: readonly MatterStatus[] = [
  "intake",
  "consultation",
  "open",
  "hold",
  "closed",
];

/** Every lifecycle label, in lifecycle order — what a filter offers whether or not one is loaded. */
export const MATTER_STATUS_LABELS: readonly string[] = MATTER_STATUSES.map(matterStatusLabel);

/**
 * The statuses a matter can be CREATED in, as the contract stands.
 *
 * Closed is deliberately absent rather than removed from the vocabulary: the intake renders it,
 * disabled, saying what it waits on. A firm does open a file that is already finished — recording
 * a concluded matter the firm handled before it kept its record here is the ordinary case — so the
 * gap is the contract's, not the design's.
 */
export const CREATABLE_MATTER_STATUSES: readonly MatterStatus[] = [
  "intake",
  "consultation",
  "open",
];

/** Whether a matter can be created in this status today. */
export function isCreatableMatterStatus(status: MatterStatus): boolean {
  return CREATABLE_MATTER_STATUSES.includes(status);
}

/**
 * Why a matter cannot be started on hold, and never will be. A hold is a pause of work the firm
 * was doing, placed on an active matter from its status window; a file that starts paused has no
 * work to pause. Stated as its own sentence, not a Soon, because nothing is coming.
 */
export const HOLD_AT_CREATION_REASON =
  "An active matter is put on hold from its status window. While on hold, no work can start on it.";

/** What creating a matter already closed waits on, as a noun phrase the Soon affordance completes. */
export const CLOSED_AT_CREATION_DEPENDENCY = "creating a matter as closed";
