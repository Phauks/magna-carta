/*
 * The one lifecycle step each matter status offers, and everything a person is told before taking
 * it.
 *
 * WHY THIS IS A MODEL AND NOT MARKUP. The words on the window that closes a firm's file are worth a
 * test, and a test cannot reach a sentence written inside a template. So the consequences, the
 * preconditions and the reading of a refusal live here, and the window renders them.
 *
 * ONE STEP, NEVER A PICKER. A matter's status is not a field somebody chooses a value for. Each
 * status offers exactly one next step: a consultation opens, an active matter closes, a closed
 * matter reopens. That is also the shape of the contract — three operations, each a POST with no
 * body, none of which takes a status. A control that let somebody pick "Closed" from a list would
 * be offering a state the lifecycle may not put a matter in from where it stands.
 *
 * WHAT THE CONSEQUENCES SAY AND WHY THEY ARE HERE AT ALL. Closing is the one step that is worth
 * stopping over: it is the step somebody takes once, on somebody else's file, and the two things
 * people assume about it are both wrong. Closing does not seal a matter (the record still takes
 * entries), and it does not fail quietly over money (the firm's own trust and credit rules refuse
 * it outright). Stating both before the press is not the surface explaining itself; it is the
 * result of the press, said in advance.
 */
import type { ApiProblem } from "$lib/api/request.ts";
import type { MatterStatus } from "./matter-status.ts";
import {
  CLOSE_MATTER_PERMISSION,
  OPEN_MATTER_PERMISSION,
  REOPEN_MATTER_PERMISSION,
} from "./matters-api.ts";

/** The lifecycle operations, which are also the three endpoints that serve them. */
export type MatterLifecycleAction = "open" | "close" | "reopen";

export interface MatterLifecycleStep {
  /** Which operation the step runs. */
  readonly action: MatterLifecycleAction;
  /** The control's label, title case, as every other primary action in the product is written. */
  readonly label: string;
  /** What the control reads while the call is in flight. */
  readonly busyLabel: string;
  /** The heading over the consequences, title case. */
  readonly consequencesHeading: string;
  /** What the step does to the record. One fact per entry, each rendered as its own row. */
  readonly consequences: readonly string[];
  /** What the server checks before it will take the step. Empty where it checks nothing. */
  readonly requirements: readonly string[];
  /** The permission the endpoint names, so the control can say no before the server has to. */
  readonly permission: string;
  /** What is said once the step has been taken. */
  readonly doneSentence: string;
  /** What is said when the step failed and the server did not say why. */
  readonly failureSentence: string;
}

/**
 * What is said when nothing answered at all.
 *
 * One sentence for all three steps, because the fact it states is the same one in each case and it
 * is the fact that matters: no lifecycle call is a partial write, so a call that did not arrive left
 * the matter exactly where it was.
 */
export const MATTER_LIFECYCLE_TRANSPORT_FAILURE =
  "Nothing answered. The matter's status is unchanged.";

/**
 * The step each status offers.
 *
 * Every sentence here states what the platform actually does. Opening draws the number from the
 * firm's own counter; closing stamps a close date the contract will not let a re-close move, and is
 * refused by the trust and client-credit rules; reopening clears that date and restores the status
 * the matter held before, which is the server's decision and not this screen's.
 */
export const MATTER_LIFECYCLE_STEPS: Readonly<Record<MatterStatus, MatterLifecycleStep>> = {
  prospective: {
    action: "open",
    label: "Open Matter",
    busyLabel: "Opening",
    consequencesHeading: "What Opening Does",
    consequences: [
      "The firm's next matter number is drawn now, and stays with this matter for good.",
      "The matter joins the firm's working docket, where a consultation does not appear.",
    ],
    requirements: [],
    permission: OPEN_MATTER_PERMISSION,
    doneSentence: "The matter is open.",
    failureSentence: "The matter could not be opened.",
  },
  open: {
    action: "close",
    label: "Close Matter",
    busyLabel: "Closing",
    consequencesHeading: "What Closing Does",
    consequences: [
      "The matter leaves the firm's active lists.",
      "The record stays, and still takes entries against it. Closing archives a matter; it does not seal it.",
      "Today becomes the matter's close date, and a later close never moves it.",
      "The matter number is untouched.",
    ],
    requirements: [
      "The client's trust ledger for this matter holds nothing, and carries no disputed-funds hold.",
      "No client credit is open against it, meaning money the firm has already conceded it owes back.",
    ],
    permission: CLOSE_MATTER_PERMISSION,
    doneSentence: "The matter is closed.",
    failureSentence: "The matter could not be closed.",
  },
  closed: {
    action: "reopen",
    label: "Reopen Matter",
    busyLabel: "Reopening",
    consequencesHeading: "What Reopening Does",
    consequences: [
      "The matter returns to the standing it held before it closed: Active if it carries a number, Prospective if it does not.",
      "The recorded close date is cleared.",
      "The matter number is untouched.",
    ],
    requirements: [],
    permission: REOPEN_MATTER_PERMISSION,
    doneSentence: "The matter is open again.",
    failureSentence: "The matter could not be reopened.",
  },
};

/** The step a matter in this status offers. */
export function matterLifecycleStep(status: MatterStatus): MatterLifecycleStep {
  return MATTER_LIFECYCLE_STEPS[status];
}

/**
 * The problem type the close endpoint answers with when its preconditions refuse a matter. Matched
 * on the type rather than the status, because a 409 also means a request with this idempotency key
 * is still running, and that is not a refusal a person can do anything about.
 */
export const CLOSE_REFUSED_PROBLEM_TYPE = "matter-close-refused";

/** One rule that refused a close, in the words of the subsystem that owns it. */
export interface MatterCloseRefusal {
  /** The rule, machine-readable. Absent where a server answered without one. */
  readonly code: string | undefined;
  /** What is in the way and what clears it, as one sentence. */
  readonly reason: string;
}

/**
 * The named reasons a close was refused, or nothing where the failure was something else.
 *
 * The refusal is the useful half of a refused close: each entry names what is in the way AND the
 * movements that clear it, which is what somebody told no actually needs. A generic failure line
 * would throw all of that away, so a caller that renders one without asking here first is losing
 * the only part of the answer that can be acted on.
 */
export function matterCloseRefusals(problem: ApiProblem): readonly MatterCloseRefusal[] {
  if (problem.type !== CLOSE_REFUSED_PROBLEM_TYPE) return [];
  return (problem.errors ?? []).flatMap((reason) =>
    reason.detail === undefined || reason.detail === ""
      ? []
      : [refusal(reason.code, reason.detail)],
  );
}

// A precondition writes its message as the tail of a sentence ("this matter still holds $400 on…"),
// because the subsystem that owns the rule does not know what the surface above it will put in
// front of it. Rendered as its own line, it needs the capital the server did not supply. Only the
// first character is touched: the amounts, account names and dates in the rest are the server's.
function refusal(code: string | undefined, detail: string): MatterCloseRefusal {
  return { code, reason: `${detail.charAt(0).toUpperCase()}${detail.slice(1)}` };
}

/**
 * Why the step cannot be taken from this screen, or nothing where it can.
 *
 * The three answers are different and a person can act on exactly one of them, so they are never
 * collapsed into a single "unavailable". A sample matter is a fixture with no record behind it; a
 * missing permission is an account question for whoever administers the firm; a session still being
 * read is a wait.
 */
export function matterLifecycleBlock(options: {
  readonly step: MatterLifecycleStep;
  readonly isSample: boolean;
  /** Whether the session read has come back at all, either way. */
  readonly sessionSettled: boolean;
  /** The permissions it answered with, or null where the read itself failed. */
  readonly permissions: readonly string[] | null;
}): string | null {
  if (options.isSample) {
    return "This is a sample matter, not one of the firm's. Its status is fixed so the three lifecycle states stay reviewable.";
  }
  if (!options.sessionSettled) return "Reading your session.";
  // A session that could not be read is UNKNOWN, not unprivileged, and the two must not be said the
  // same way. Blocking here would refuse somebody who holds the permission, on the strength of a
  // failed read; the server checks the same permission and answers in its own words, so the step
  // stays offered and the refusal, if there is one, comes from the authority on it.
  if (options.permissions === null) return null;
  if (!options.permissions.includes(options.step.permission)) {
    return `This step needs the ${options.step.permission} permission, which this account does not hold.`;
  }
  return null;
}
