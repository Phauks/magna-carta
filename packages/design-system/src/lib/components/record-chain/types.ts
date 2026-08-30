/*
 * RecordChain's model: the stages a record passes through, and the lock a stage puts on it.
 *
 * The stage names are status-register keys on purpose. The chain does not own a vocabulary of its
 * own — it renders the same words, with the same meanings on hover, that the chip on the row above
 * it renders. `void` is deliberately not a stage: a withdrawn record has left the chain rather than
 * reached a step of it, and it says so through its chip.
 */
import type { StatusKey } from "../../status-register/index.ts";

/** A step of the chain. Every one of these is also a key in the status register. */
export type RecordChainStage = Extract<
  StatusKey,
  "draft" | "submitted" | "approved" | "billed" | "paid"
>;

/**
 * The thing a lock points at, which is almost always the invoice a record was billed on. It is a
 * LINK rather than a sentence about the link: a lock states its fact and hands over its object, so
 * the reader can open it instead of being told about it.
 */
export interface RecordChainLockObject {
  /** How the object names itself, e.g. an invoice number. */
  label: string;
  href: string;
}

export interface RecordChainLock {
  /**
   * Overrides the settled reason for the record's stage. Leave it out and the chain states the
   * stage's own reason, which is why every locked record in the product says the same thing.
   */
  reason?: string;
  object?: RecordChainLockObject;
}
