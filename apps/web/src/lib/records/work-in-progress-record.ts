/*
 * What every work-in-progress ledger reads off a record, in one home.
 *
 * Time, fees and costs are three stores of the same shape: a dated record that rides one chain —
 * draft, submitted, approved, billed, void — is written down by somebody, can be sent back by a
 * reviewer, and is editable only while it is a draft. The facts below are about THAT shape rather
 * than about a disbursement or a charge, so they belong here rather than in any one ledger's
 * vocabulary.
 *
 * THIS FILE EXISTS BECAUSE THE ALTERNATIVE ALREADY HAPPENED. `canWorkDraft` was written twice,
 * byte-identical, on the matter's cost surface and the firm's — and both copies carried a comment
 * promising a rule the accepted design refuses. Two copies is how two surfaces start disagreeing
 * about whether the record in front of a reader can be changed, and nobody notices until one of
 * them is corrected. The fee surfaces are the moment to hoist rather than the moment to write a
 * third copy.
 *
 * The parameter type is STRUCTURAL, not a ledger's own row type: a caller passes anything carrying
 * the fields a reading needs, so this module depends on no ledger and every ledger can use it.
 */
import { personName } from "@magna-carta/design-system/formatters";
import { statusEntry, type StatusKey } from "@magna-carta/design-system/status-register";

/** The chain every work-in-progress record rides, in the words the register uses. */
export type WorkInProgressStatus = "draft" | "submitted" | "approved" | "billed" | "void";

/**
 * The fields a shared reading needs. Every one is optional except the status, so a ledger whose
 * wire does not carry a fact yet can still use the readings that do not depend on it.
 */
export interface WorkInProgressRecord {
  readonly status: WorkInProgressStatus;
  readonly createdByUserId?: string | null;
  readonly createdByName?: string | null;
  readonly kickBackReason?: string | null;
}

/** Who wrote a record down, in the three shapes that fact can honestly be in. */
export type RecorderState =
  | { readonly kind: "unrecorded" }
  | { readonly kind: "gone" }
  | { readonly kind: "named"; readonly name: string };

/**
 * The member who recorded a record.
 *
 * `createdByName` is null both when nobody was recorded — a row written by an import, or one from
 * before the column was filled — and when the member row behind a recorded identifier is gone.
 * `createdByUserId` tells those apart, which is the whole reason both reach the wire. The
 * identifier is deliberately not a foreign key on any of the three tables, because who wrote a
 * record down is a fact about the past that outlives that person's membership.
 */
export function recorderState(record: WorkInProgressRecord): RecorderState {
  const identifier = record.createdByUserId ?? null;
  if (identifier === null) return { kind: "unrecorded" };
  // Through the product's own name reading, so a blank display name and a first-person stand-in
  // read as an absent name here rather than being printed at somebody.
  const name = personName(record.createdByName, { whenUnrecorded: "" });
  return name === "" ? { kind: "gone" } : { kind: "named", name };
}

/** What the recorder reads as in a cell, a filter list and a printed sheet: one wording, one home. */
export function recorderText(record: WorkInProgressRecord): string {
  const state = recorderState(record);
  switch (state.kind) {
    case "unrecorded":
      return "Not recorded";
    case "gone":
      return "No longer at the firm";
    default:
      return state.name;
  }
}

/**
 * Why a recorder has no name.
 *
 * The identifier is on the record and the member row it names is not, which is the shape a
 * departure leaves behind. It is not a hole in the record: the column is deliberately not a foreign
 * key precisely so that who wrote a record down outlives that person's membership.
 */
export const GONE_RECORDER_NOTE =
  "The person who recorded this has left the firm, so their name isn't shown. The record is unchanged.";

/**
 * Why a draft came back, or null where it did not.
 *
 * A returned draft and a draft nobody has submitted are the same status and look identical on a
 * ledger, which leaves the person who has to fix the record with nothing to go on. The reason is
 * the only thing that tells them apart.
 *
 * The status guard is belt-and-braces rather than a correction: every service clears the reason on
 * the next submission, so a non-draft cannot carry one. Reading it as a DRAFT fact anyway means no
 * surface can ever print "sent back because…" over a record that has since been approved, whatever
 * a future transition forgets to clear.
 */
export function returnedDraftReason(record: WorkInProgressRecord): string | null {
  if (record.status !== "draft") return null;
  const reason = record.kickBackReason?.trim() ?? "";
  return reason === "" ? null : reason;
}

/**
 * Whether a record is this reader's to change, and the sentence that says why either way.
 *
 * THE RULE IS THE CHAIN, NOT THE RECORDER, and that is settled rather than provisional. A cost
 * belongs to the MATTER it was advanced for and a fee to the matter it charges, not to whoever
 * typed either, so no read or write on them is scoped per person — the deliberate difference from
 * time, where an entry is somebody's own hours. So the recorder being on the record changes
 * nothing here: it is who to ask about a figure that looks wrong, never a gate. What decides is
 * where the record stands — a draft is editable, and everything past it is evidence.
 */
export function canWorkDraft(record: WorkInProgressRecord): {
  allowed: boolean;
  reason: string;
} {
  if (record.status !== "draft") {
    return {
      allowed: false,
      reason: statusEntry(record.status as StatusKey).meaning,
    };
  }
  return { allowed: true, reason: "Change any part of this draft." };
}
