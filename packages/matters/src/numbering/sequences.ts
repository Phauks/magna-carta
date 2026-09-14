import type { NumberSegment } from "./segments.ts";
import {
  isConsultationNumberConflict,
  isIntakeNumberConflict,
  isMatterNumberConflict,
  type NumberingPurpose,
} from "../matter-statements.ts";
import { CONSULTATION_SCOPE_PREFIX, DEFAULT_CONSULTATION_SCHEME } from "./consultation-scheme.ts";
import { DEFAULT_INTAKE_SCHEME, INTAKE_SCOPE_PREFIX } from "./intake-scheme.ts";

/*
 * What each sequence is, resolved in one table rather than in `purpose === "consultation"` branches.
 *
 * It was two branches while there were two sequences, and it read fine. A third made the shape of
 * the problem visible: the prefix, the label, the retryable collision and whether a default exists
 * are four facts ABOUT A SEQUENCE, and spread across four conditionals they can disagree — a fourth
 * run added later would have had to find all four. The table is also the argument: a reader can see
 * at a glance that every run but the matter run has a default, and why.
 */
export interface Sequence {
  /** What the run is called when a draw that could not converge has to be reported. */
  readonly label: string;
  /**
   * What keeps this run's counters separate from the others'. Empty for the matter run, which owns
   * the unprefixed scope keys; the others namespace theirs. See the prefix constants for why no
   * matter scope key can collide with a prefixed one.
   */
  readonly scopePrefix: string;
  /**
   * The rendered-string collision only this run's own partial unique index can see — a number a
   * court or a legacy system already assigned by hand, which drew no allocation row. Matched per
   * run, because a draw that retried on another run's collision would step its own counter past a
   * number nobody had taken.
   */
  readonly isOwnConflict: (error: unknown) => boolean;
  /**
   * The scheme to render from when the firm has configured none, or null to refuse.
   *
   * Only the matter run refuses. A matter number is the firm's own file numbering and there is no
   * defensible default — rendering one would stamp a shape the firm never chose onto a number that
   * is then frozen. A consultation number and an intake number are scaffolding for a file that may
   * never exist, and refusing to take an enquiry because nobody has visited the settings screen is
   * the worse failure.
   */
  readonly fallbackScheme: readonly NumberSegment[] | null;
}

const SEQUENCES: Record<NumberingPurpose, Sequence> = {
  matter: {
    label: "matter number",
    scopePrefix: "",
    isOwnConflict: isMatterNumberConflict,
    fallbackScheme: null,
  },
  consultation: {
    label: "consultation number",
    scopePrefix: CONSULTATION_SCOPE_PREFIX,
    isOwnConflict: isConsultationNumberConflict,
    fallbackScheme: DEFAULT_CONSULTATION_SCHEME,
  },
  intake: {
    label: "intake number",
    scopePrefix: INTAKE_SCOPE_PREFIX,
    isOwnConflict: isIntakeNumberConflict,
    fallbackScheme: DEFAULT_INTAKE_SCHEME,
  },
};

/** What this sequence is. The one place any of its four facts is answered. */
export function sequenceOf(purpose: NumberingPurpose): Sequence {
  return SEQUENCES[purpose];
}
