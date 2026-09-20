import { purposeOf } from "@magna-carta/sequence-numbering/purposes";
import {
  isConsultationNumberConflict,
  isIntakeNumberConflict,
  isMatterNumberConflict,
  type MatterNumberingPurpose,
} from "../matter-statements.ts";

/*
 * What is MATTERS' OWN about each of its three sequences, resolved in one table rather than in
 * `purpose === "consultation"` branches. What a sequence is — its label, its scope prefix, its
 * default scheme and the parts it may use — lives on the firm-wide numbering register
 * (@magna-carta/sequence-numbering/purposes), one row per purpose, so a fourth run is one row there
 * rather than four edits here. The one fact that cannot leave this package is the rendered-string
 * collision only this run's own partial unique index on the matter table can see.
 */
export interface MatterSequence {
  /** What the run is called when a draw that could not converge has to be reported. */
  readonly label: string;
  /**
   * The rendered-string collision only this run's own partial unique index can see — a number a
   * court or a legacy system already assigned by hand, which drew no allocation row. Matched per
   * run, because a draw that retried on another run's collision would step its own counter past a
   * number nobody had taken.
   */
  readonly isOwnConflict: (error: unknown) => boolean;
}

const OWN_CONFLICTS: Record<MatterNumberingPurpose, (error: unknown) => boolean> = {
  matter: isMatterNumberConflict,
  consultation: isConsultationNumberConflict,
  intake: isIntakeNumberConflict,
};

/** What this sequence is to the matter shell. The one place its own collision is answered. */
export function matterSequenceOf(purpose: MatterNumberingPurpose): MatterSequence {
  return { label: purposeOf(purpose).label, isOwnConflict: OWN_CONFLICTS[purpose] };
}
