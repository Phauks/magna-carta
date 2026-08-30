/*
 * The chain's stages and its lock language, as pure functions — the part of RecordChain that can be
 * wrong silently, and therefore the part that is tested rather than trusted.
 *
 * The lock language lives here rather than at each call site because every locked record in the
 * product has to say the same thing. A window that composes its own sentence is how two surfaces
 * end up disagreeing about what a billed record can still be edited into.
 */
import type { RecordChainStage } from "./types.ts";

/** The chain, in order, where the firm has review turned on. */
export const RECORD_CHAIN_STAGES: readonly RecordChainStage[] = [
  "draft",
  "submitted",
  "approved",
  "billed",
  "paid",
];

/** Where a stage sits relative to the one the record has actually reached. */
export type RecordChainStepState = "past" | "present" | "future";

/**
 * A stage's position relative to the record's current stage. A stage the record has not reached is
 * still rendered: knowing what is still ahead is the reason to draw a chain rather than a chip.
 */
export function recordChainStepState(
  stage: RecordChainStage,
  current: RecordChainStage,
): RecordChainStepState {
  const stageIndex = RECORD_CHAIN_STAGES.indexOf(stage);
  const currentIndex = RECORD_CHAIN_STAGES.indexOf(current);
  if (stageIndex < currentIndex) return "past";
  if (stageIndex > currentIndex) return "future";
  return "present";
}

/**
 * The two forms a stage's lock reason takes.
 *
 * `leadingToObject` is a lead-in the linked object completes, so a billed record reads "Billed on
 * Invoice 2026-114" with the invoice as a link the reader can open. `alone` is the same fact for a
 * record whose object cannot be linked, so the line is never left dangling on a preposition.
 */
interface RecordChainLockCopy {
  leadingToObject: string;
  alone: string;
}

const LOCK_COPY: Readonly<Record<RecordChainStage, RecordChainLockCopy | null>> = {
  // A draft is editable, full stop. It has no lock and therefore no lock line.
  draft: null,
  submitted: {
    leadingToObject: "Submitted for review:",
    alone: "Submitted for review. Send it back to draft to edit it.",
  },
  approved: {
    leadingToObject: "Approved for billing:",
    alone: "Approved for billing. Send it back to draft to edit it.",
  },
  billed: {
    leadingToObject: "Billed on",
    alone: "Billed on a finalized invoice.",
  },
  paid: {
    leadingToObject: "Paid on",
    alone: "Paid on a finalized invoice.",
  },
};

/**
 * What a record at this stage says about being locked, or null where nothing is locked.
 *
 * The reason names the stage and, where there is one, hands over the object. It stops there: a
 * lock states its fact and links its object, and the rest of what a reader might want to know
 * about corrections rides the chip's and the chain's hovers.
 */
export function recordChainLockReason(
  stage: RecordChainStage,
  options: { hasLinkedObject: boolean },
): string | null {
  const copy = LOCK_COPY[stage];
  if (copy === null) return null;
  return options.hasLinkedObject ? copy.leadingToObject : copy.alone;
}
