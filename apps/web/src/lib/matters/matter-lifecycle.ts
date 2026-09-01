/*
 * The one lifecycle step each matter status offers, and the facts the status window states beside
 * it.
 *
 * WHY THIS IS A MODEL AND NOT MARKUP. The words on the window that closes a firm's file are worth a
 * test, and a test cannot reach a sentence written inside a template.
 *
 * ONE STEP, NEVER A PICKER. A matter's status is not a field somebody chooses a value for. Each
 * status offers exactly one next step: a consultation opens, an active matter closes, a closed
 * matter reopens. That is also the shape of the contract — three operations, each a POST with no
 * body, none of which takes a status. A control that let somebody pick "Closed" from a list would
 * be offering a state the lifecycle may not put a matter in from where it stands.
 *
 * THE PROGRAM DECIDES WHETHER A MATTER CAN CLOSE, AND THE WINDOW REPORTS IT. There is no checklist
 * for a person to work through: the close-readiness route runs the firm's own registered rules
 * read-only and answers, so the window states a verdict it was handed rather than a list of things
 * to go and confirm. What to do about a No is in the refusal itself, which names the amount, where
 * it sits, and the movements that clear it.
 */
import type { ApiProblem } from "$lib/api/request.ts";
import { soonDependencySentence } from "$lib/maturity/soon-affordance.ts";
import type { MatterStatus } from "./matter-status.ts";
import {
  CLOSE_MATTER_PERMISSION,
  OPEN_MATTER_PERMISSION,
  REOPEN_MATTER_PERMISSION,
  type MatterCloseBlocker,
  type MatterCloseReadiness,
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

/** The step each status offers. */
export const MATTER_LIFECYCLE_STEPS: Readonly<Record<MatterStatus, MatterLifecycleStep>> = {
  prospective: {
    action: "open",
    label: "Open Matter",
    busyLabel: "Opening",
    permission: OPEN_MATTER_PERMISSION,
    doneSentence: "The matter is open.",
    failureSentence: "The matter could not be opened.",
  },
  open: {
    action: "close",
    label: "Close Matter",
    busyLabel: "Closing",
    permission: CLOSE_MATTER_PERMISSION,
    doneSentence: "The matter is closed.",
    failureSentence: "The matter could not be closed.",
  },
  closed: {
    action: "reopen",
    label: "Reopen Matter",
    busyLabel: "Reopening",
    permission: REOPEN_MATTER_PERMISSION,
    doneSentence: "The matter is open again.",
    failureSentence: "The matter could not be reopened.",
  },
};

/** The step a matter in this status offers. */
export function matterLifecycleStep(status: MatterStatus): MatterLifecycleStep {
  return MATTER_LIFECYCLE_STEPS[status];
}

// ---- can it close? ------------------------------------------------------------------------------

/**
 * Where the verdict stands.
 *
 * `unknown` is its own answer and never collapses into `blocked`. A rule that refused and a question
 * nobody could put are different facts, and only the first is one a person can act on; showing the
 * second as a refusal would send somebody looking for money that is not there.
 */
export type MatterCloseVerdict = "checking" | "ready" | "blocked" | "unknown";

export interface MatterCloseStanding {
  readonly verdict: MatterCloseVerdict;
  /** The verdict in one line. */
  readonly sentence: string;
  /** Each rule that stands in the way, in the words of the subsystem that owns it. */
  readonly blockers: readonly MatterCloseBlocker[];
}

/**
 * The verdict, from what the readiness route answered.
 *
 * `null` means the answer has not arrived yet; `failed` means it could not be had at all. The rule
 * messages are the server's own sentences and reach the screen unedited apart from the capital the
 * subsystem did not supply, because each is written as the tail of a sentence.
 */
export function matterCloseStanding(
  readiness: MatterCloseReadiness | null,
  failed = false,
): MatterCloseStanding {
  if (failed) {
    return {
      verdict: "unknown",
      sentence: "Whether this matter can close could not be read.",
      blockers: [],
    };
  }
  if (readiness === null) return { verdict: "checking", sentence: "Checking", blockers: [] };
  if (readiness.closable) {
    return { verdict: "ready", sentence: "Ready to close.", blockers: [] };
  }
  return {
    verdict: "blocked",
    sentence: "Not ready to close.",
    blockers: readiness.blockers.map((blocker) => ({
      code: blocker.code,
      message: leadingCapital(blocker.message),
    })),
  };
}

// A rule writes its message as the tail of a sentence ("this matter still holds $400 on…"), because
// the subsystem that owns the rule does not know what the surface above it will put in front of it.
// Rendered as its own line it needs the capital the server did not supply. Only the first character
// is touched: the amounts, account names and dates in the rest are the server's.
function leadingCapital(message: string): string {
  return `${message.charAt(0).toUpperCase()}${message.slice(1)}`;
}

/**
 * The problem type the close endpoint answers with when its preconditions refuse a matter. Matched
 * on the type rather than the status, because a 409 also means a request with this idempotency key
 * is still running, and that is not a refusal a person can do anything about.
 */
export const CLOSE_REFUSED_PROBLEM_TYPE = "matter-close-refused";

/**
 * The named reasons a close was refused, or nothing where the failure was something else.
 *
 * A close refused at the last moment answers in the same shape the readiness route answers in, so
 * it updates the verdict already on screen rather than arriving as a second kind of message. That
 * is not a coincidence to be relied on quietly: it is why both read the rules' own failures.
 */
export function matterCloseRefusals(problem: ApiProblem): readonly MatterCloseBlocker[] {
  if (problem.type !== CLOSE_REFUSED_PROBLEM_TYPE) return [];
  return (problem.errors ?? []).flatMap((reason) =>
    reason.detail === undefined || reason.detail === ""
      ? []
      : [{ code: reason.code ?? "", message: leadingCapital(reason.detail) }],
  );
}

// ---- the physical file ---------------------------------------------------------------------------

/**
 * Where the firm's own paper file for this matter sits, and the date it may be destroyed.
 *
 * NEITHER IS MODELLED, AND NEITHER IS THE CUSTODY REGISTER. Custodian holds CLIENT property left
 * with the firm to guard — an original will, a deed, a passport — which stays in the register for as
 * long as the client's affairs need it, long after the matter that brought it in has closed. The
 * firm's own file for a matter is a different object with a different life, and the platform does
 * not carry it: no register, no location, and no retention clock anywhere to derive a destruction
 * date from. The custody register is explicit that it runs no timer at all — an original is
 * destroyed on a written basis, by two people, never because a date arrived.
 *
 * So both rows render and say what they are waiting for, which is the standing rule for anything
 * designed ahead of what serves it. A date invented here would be a date somebody destroys a
 * client's file on.
 */
export interface MatterPhysicalFileFact {
  readonly key: string;
  readonly label: string;
  /** The one honest sentence the row owes about what it is waiting for. */
  readonly waitingOn: string;
}

export const MATTER_PHYSICAL_FILE_FACTS: readonly MatterPhysicalFileFact[] = [
  {
    key: "location",
    label: "Physical File",
    waitingOn: soonDependencySentence("a register of the firm's own physical files"),
  },
  {
    key: "destroy-after",
    label: "Destroy After",
    waitingOn: soonDependencySentence("a firm file-retention policy"),
  },
];

// ---- what stops the step being taken from this screen ---------------------------------------------

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
