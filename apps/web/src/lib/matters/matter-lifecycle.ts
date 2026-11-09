/*
 * The lifecycle steps each matter status offers, and the facts the status window states beside
 * them.
 *
 * WHY THIS IS A MODEL AND NOT MARKUP. The words on the window that closes a firm's file are worth a
 * test, and a test cannot reach a sentence written inside a template.
 *
 * STEPS, NEVER A PICKER — AND ONE MODAL IS WHERE THEY ARE READ AND TAKEN. A matter's status is not
 * a field somebody chooses a value for. Each status offers the next steps the lifecycle allows from
 * where it stands, and no others: an intake completes into a consultation; a consultation opens, is
 * put on hold, or closes (the firm decided against it); an active matter closes or is put on hold; a
 * matter on hold is released or closes; a closed matter reopens. That is also the shape of the
 * contract — one operation per step, each a POST, none of which takes a status (the hold alone
 * takes a body: its reason).
 *
 * The status seal on the matter's header is a PILLBOX: it states the status and opens the window
 * that reads the record (owner ruling, 2026-09-14, which reverses the dropdown of 2026-09-11). One
 * control in that window changes the status, named for the act rather than for any one step, and it
 * opens the status-change modal — where the steps available from here are listed, each with what it
 * requires already answered, and where the chosen one is taken.
 *
 * WHY THAT MODAL IS STILL NOT A STATUS PICKER. What it offers is what can be DONE from where the
 * matter stands, never the five statuses. A control that let somebody pick "Closed" from a list
 * would be offering a state the lifecycle may not put a matter in from where it stands, and it
 * would have nowhere to ask for the hold's reason or to state what closing requires. The lifecycle
 * still decides which steps exist; naming their requirements on the way past is what a reader
 * needed and a menu of verbs could not give them. The contract is unchanged by any of it.
 *
 * So each step carries its own `consequence`: the plain sentence saying what taking it does to the
 * record, which is what the modal states beside a chosen step that has no rules of its own to read.
 *
 * Where a status offers several steps, the first is the one the lifecycle runs toward, then the
 * pause, then the exit.
 *
 * THE PROGRAM ANSWERS THE REQUIREMENTS, NOT THE READER. The close-readiness route runs the firm's
 * own registered rules read-only, so the window lists what closing requires with each one already
 * answered, rather than handing somebody a list of things to go and confirm. What to do about an
 * unmet requirement is in the rule's own words, which name the amount, where it sits, and the
 * movements that clear it.
 */
import {
  addCalendarDays,
  civilDateFromParts,
  civilDateParts,
  endOfCivilMonth,
} from "@magna-carta/civil-time/civil-date";
import type { Problem } from "$lib/api/request.ts";
import type { MatterStatus } from "./matter-status.ts";
import { permissionRefusal } from "$lib/access/refusal.ts";
import {
  CLOSE_MATTER_PERMISSION,
  GRADUATE_MATTER_PERMISSION,
  HOLD_MATTER_PERMISSION,
  OPEN_MATTER_PERMISSION,
  REOPEN_MATTER_PERMISSION,
  type MatterCloseBlocker,
  type MatterCloseReadiness,
  type MatterGraduateReadiness,
  type MatterOpenReadiness,
} from "./matters-api.ts";

/** The lifecycle operations, which are also the endpoints that serve them. */
export type MatterLifecycleAction = "graduate" | "open" | "hold" | "release" | "close" | "reopen";

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
  /**
   * What taking this step does to the record, in one sentence, before it is taken.
   *
   * Every step has one, including the three that no rule gates. A reader choosing between Release
   * Hold and Close Matter is asking what each would do, and for those two there is no requirement
   * list to answer it — the consequence is the whole of what the modal has to say about them.
   */
  readonly consequence: string;
}

/**
 * What is said when nothing answered at all.
 *
 * One sentence for every step, because the fact it states is the same one in each case and it
 * is the fact that matters: no lifecycle call is a partial write, so a call that did not arrive left
 * the matter exactly where it was.
 */
export const MATTER_LIFECYCLE_TRANSPORT_FAILURE =
  "Nothing answered. The matter's status is unchanged.";

const GRADUATE_STEP: MatterLifecycleStep = {
  action: "graduate",
  label: "Complete Intake",
  busyLabel: "Completing",
  permission: GRADUATE_MATTER_PERMISSION,
  doneSentence: "The intake is complete. The matter is a consultation.",
  failureSentence: "The intake could not be completed.",
  consequence:
    "The matter becomes a consultation and draws its tentative consultation number. No matter number is drawn until the matter opens.",
};
const OPEN_STEP: MatterLifecycleStep = {
  action: "open",
  label: "Open Matter",
  busyLabel: "Opening",
  permission: OPEN_MATTER_PERMISSION,
  doneSentence: "The matter is open.",
  failureSentence: "The matter could not be opened.",
  consequence:
    "The matter becomes active and draws its permanent matter number. The consultation number it wore stays on the record.",
};
const HOLD_STEP: MatterLifecycleStep = {
  action: "hold",
  label: "Put On Hold",
  busyLabel: "Holding",
  permission: HOLD_MATTER_PERMISSION,
  doneSentence: "The matter is on hold. It keeps its number, and returns to active when released.",
  failureSentence: "The matter could not be put on hold.",
  consequence:
    "Work pauses. The matter keeps its number, the reason is recorded beside the status, and releasing the hold returns it to active.",
};
// The same pause on a consultation, said in the consultation's own terms: the firm has parked a
// file it has not decided on. It wears its tentative number, and a release returns it to being a
// consultation — never to active, because nothing opened it.
const CONSULTATION_HOLD_STEP: MatterLifecycleStep = {
  ...HOLD_STEP,
  doneSentence:
    "The consultation is on hold. It keeps its tentative number, and is a consultation again when released.",
  failureSentence: "The consultation could not be put on hold.",
  consequence:
    "Work pauses. The consultation keeps its tentative number, the reason is recorded beside the status, and releasing the hold returns it to being a consultation.",
};
const RELEASE_STEP: MatterLifecycleStep = {
  action: "release",
  label: "Release Hold",
  busyLabel: "Releasing",
  permission: HOLD_MATTER_PERMISSION,
  doneSentence: "The hold is released. The matter is back where the hold found it.",
  failureSentence: "The hold could not be released.",
  consequence:
    "Work resumes. The matter returns to where the hold found it, the reason clears, and the record keeps that it was held.",
};
const CLOSE_STEP: MatterLifecycleStep = {
  action: "close",
  label: "Close Matter",
  busyLabel: "Closing",
  permission: CLOSE_MATTER_PERMISSION,
  doneSentence: "The matter is closed.",
  failureSentence: "The matter could not be closed.",
  consequence:
    "The file closes and the day it closed is stamped on the record. Nothing is deleted, and a closed matter can be reopened.",
};
// Declining a consultation is a close: the same operation, the same requirements (which a
// consultation with nothing on its ledgers passes), and the same additive record afterwards. It
// keeps its tentative number and draws no matter number, so the firm's matter run stays dense.
const CONSULTATION_CLOSE_STEP: MatterLifecycleStep = {
  ...CLOSE_STEP,
  label: "Close Consultation",
  doneSentence:
    "The consultation is closed. It keeps its tentative number and drew no matter number.",
  failureSentence: "The consultation could not be closed.",
  consequence:
    "The firm declines the consultation. It keeps its tentative number, draws no matter number, and can be reopened.",
};
const REOPEN_STEP: MatterLifecycleStep = {
  action: "reopen",
  label: "Reopen Matter",
  busyLabel: "Reopening",
  permission: REOPEN_MATTER_PERMISSION,
  doneSentence: "The matter is back where it was before it closed.",
  failureSentence: "The matter could not be reopened.",
  consequence:
    "The matter returns to the status it left: the hold it was in, Active if it had been opened, else the consultation or intake it was. Its number is unchanged, and the recorded close date and the paper file's destruction date clear.",
};

/**
 * The steps each status offers, the first being the one the lifecycle runs toward. A consultation
 * opens, or pauses, or closes as declined; an active matter closes, or pauses; a matter on hold
 * resumes, or closes without resuming.
 */
export const MATTER_LIFECYCLE_STEPS: Readonly<
  Record<MatterStatus, readonly MatterLifecycleStep[]>
> = {
  intake: [GRADUATE_STEP],
  consultation: [OPEN_STEP, CONSULTATION_HOLD_STEP, CONSULTATION_CLOSE_STEP],
  open: [CLOSE_STEP, HOLD_STEP],
  hold: [RELEASE_STEP, CLOSE_STEP],
  closed: [REOPEN_STEP],
};

/** Every step a matter in this status offers. */
export function matterLifecycleSteps(status: MatterStatus): readonly MatterLifecycleStep[] {
  return MATTER_LIFECYCLE_STEPS[status];
}

/** The step the lifecycle runs toward from this status: the first of the steps it offers. */
export function matterLifecycleStep(status: MatterStatus): MatterLifecycleStep {
  const step = MATTER_LIFECYCLE_STEPS[status][0];
  if (step === undefined) throw new Error(`no lifecycle step for status ${status}`);
  return step;
}

/** The hold's reason: required, and short enough to print on a row. */
export const HOLD_REASON_MAX_LENGTH = 500;

/** Whether a typed reason can be recorded: not blank, and within the length a row can carry. */
export function holdReasonRefusal(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length === 0) return "Say why the matter is being put on hold.";
  if (trimmed.length > HOLD_REASON_MAX_LENGTH) {
    return `Keep the reason to ${String(HOLD_REASON_MAX_LENGTH)} characters; the account of it belongs on the matter's notes.`;
  }
  return null;
}

// ---- what closing requires -----------------------------------------------------------------------

/**
 * One thing that has to be true before a matter closes, and the refusal codes that say it is not.
 *
 * These are NOT boxes for a person to tick. Each is a rule the firm's own subsystems enforce, and
 * the close-readiness route runs all of them and answers; what this list adds is the plain statement
 * of the rule, so a met requirement reads as a sentence about the matter rather than as the absence
 * of an error. The codes are the subsystems' own (packages/trust/src/close-precondition.ts,
 * packages/billing/src/close-precondition.ts) and are spelled here because this app deliberately does
 * not depend on those packages, the same way every response shape in matters-api.ts is.
 */
interface MatterCloseRequirement {
  readonly key: string;
  readonly label: string;
  readonly codes: readonly string[];
}

const MATTER_CLOSE_REQUIREMENTS: readonly MatterCloseRequirement[] = [
  {
    key: "trust",
    label: "The client's trust ledger for this matter is empty, with no disputed-funds hold.",
    codes: ["trust-balance-not-zero", "trust-hold-active"],
  },
  {
    key: "client-credit",
    label: "No client credit is open against the matter.",
    codes: ["client-credit-open"],
  },
];

/**
 * Where one requirement stands.
 *
 * `unknown` never collapses into `unmet`. A rule that refused and a question nobody could put are
 * different facts, and only the first is one a person can act on; showing the second as a refusal
 * would send somebody looking for money that is not there.
 */
export type MatterCloseRequirementState = "checking" | "met" | "unmet" | "unknown";

export interface MatterCloseRequirementStatus {
  readonly key: string;
  /** What has to be true. For a rule this build does not know, the server's own sentence. */
  readonly label: string;
  readonly state: MatterCloseRequirementState;
  /** The rule's own words where it is what stands in the way: the amount, and what clears it. */
  readonly detail: string | null;
}

/**
 * Every requirement, answered.
 *
 * `readiness` null means the answer has not arrived; `failed` means it could not be had at all. An
 * answer resolves every requirement at once, because the route runs every rule and reports every
 * failure — so a rule the answer does not mention is a rule that passed. A refusal naming a rule
 * this build has never heard of becomes its own unmet row rather than disappearing, since a rule
 * registered after this screen shipped is the one a person most needs to read.
 */
export function matterCloseRequirements(
  readiness: MatterCloseReadiness | null,
  failed = false,
): readonly MatterCloseRequirementStatus[] {
  if (failed || readiness === null) {
    const state: MatterCloseRequirementState = failed ? "unknown" : "checking";
    return MATTER_CLOSE_REQUIREMENTS.map((requirement) => ({
      key: requirement.key,
      label: requirement.label,
      state,
      detail: null,
    }));
  }
  const known = MATTER_CLOSE_REQUIREMENTS.map((requirement) => {
    const blocking = readiness.blockers.filter((blocker) =>
      requirement.codes.includes(blocker.code),
    );
    return {
      key: requirement.key,
      label: requirement.label,
      state: (blocking.length > 0 ? "unmet" : "met") as MatterCloseRequirementState,
      detail:
        blocking.length === 0
          ? null
          : blocking.map((blocker) => leadingCapital(blocker.message)).join(" "),
    };
  });
  const accounted = new Set(MATTER_CLOSE_REQUIREMENTS.flatMap((one) => one.codes));
  const unaccounted = readiness.blockers
    .filter((blocker) => !accounted.has(blocker.code))
    .map((blocker, index) => ({
      key: blocker.code === "" ? `unnamed-${String(index)}` : blocker.code,
      label: leadingCapital(blocker.message),
      state: "unmet" as const,
      detail: null,
    }));
  return [...known, ...unaccounted];
}

/** Whether the program says this matter would close right now. Unknown until it has answered. */
export function matterCanClose(readiness: MatterCloseReadiness | null): boolean | null {
  return readiness === null ? null : readiness.closable;
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
 * it re-answers the requirements already on screen rather than arriving as a second kind of message.
 * That is not a coincidence to be relied on quietly: it is why both read the rules' own failures.
 */
export function matterCloseRefusals(problem: Problem): readonly MatterCloseBlocker[] {
  if (problem.type !== CLOSE_REFUSED_PROBLEM_TYPE) return [];
  // The transport already drops an entry missing any of path, code or detail, so what arrives here
  // is whole. A refusal names all three: the rules write to "$", the request as a whole.
  return (problem.errors ?? []).map((reason) => ({ code: reason.code, message: reason.detail }));
}

// ---- what completing the intake requires ---------------------------------------------------------

/**
 * What stands between an intake and the consultation, one row per rule that refused.
 *
 * The rows are the refusals the readiness read returned — each an intake step, in the words of
 * whoever should answer it — and an empty list with an answer means nothing stands in the way. The
 * shape is the open readiness's, one rung earlier.
 */
export function matterGraduateRequirements(
  readiness: MatterGraduateReadiness | null,
  failed = false,
): readonly MatterOpenRequirementStatus[] {
  if (failed || readiness === null) return [];
  return readiness.blockers.map((blocker, index) => ({
    key: `${blocker.code}-${String(index)}`,
    label: leadingCapital(blocker.message),
    state: "unmet" as const,
  }));
}

/** Whether the program says this intake would complete right now. Unknown until it has answered. */
export function matterCanGraduate(readiness: MatterGraduateReadiness | null): boolean | null {
  return readiness === null ? null : readiness.graduable;
}

/** The problem type the graduation answers with when the intake procedure refuses the intake. */
export const GRADUATE_REFUSED_PROBLEM_TYPE = "matter-graduate-refused";

export function matterGraduateRefusals(problem: Problem): readonly MatterCloseBlocker[] {
  if (problem.type !== GRADUATE_REFUSED_PROBLEM_TYPE) return [];
  return (problem.errors ?? []).map((reason) => ({ code: reason.code, message: reason.detail }));
}

// ---- what opening requires -----------------------------------------------------------------------

/**
 * What stands between a consultation and opening, one row per rule that refused.
 *
 * Unlike the close, the open has no fixed roster of rules to state as met. The intake procedure
 * gates the rung before this one, so today the open reports at most that the matter is not yet a
 * consultation; the rows are exactly the refusals the readiness read returned, and an empty list
 * with an answer means nothing stands in the way. `checking` and `unknown` keep the same meaning they have for the close: not asked yet, and
 * could not be asked, neither of which is a refusal.
 */
export interface MatterOpenRequirementStatus {
  readonly key: string;
  readonly label: string;
  readonly state: MatterCloseRequirementState;
}

export const INTAKE_STEP_OUTSTANDING_CODE = "intake-step-outstanding";

export function matterOpenRequirements(
  readiness: MatterOpenReadiness | null,
  failed = false,
): readonly MatterOpenRequirementStatus[] {
  if (failed || readiness === null) return [];
  return readiness.blockers.map((blocker, index) => ({
    key: `${blocker.code}-${String(index)}`,
    label: leadingCapital(blocker.message),
    state: "unmet" as const,
  }));
}

/** Whether the program says this consultation would open right now. Unknown until it has answered. */
export function matterCanOpen(readiness: MatterOpenReadiness | null): boolean | null {
  return readiness === null ? null : readiness.openable;
}

/**
 * The problem type the open endpoint answers with when its rules refuse a consultation. The same
 * shape as the close refusal, for the same reason: it re-answers the requirements already on screen.
 */
export const OPEN_REFUSED_PROBLEM_TYPE = "matter-open-refused";

export function matterOpenRefusals(problem: Problem): readonly MatterCloseBlocker[] {
  if (problem.type !== OPEN_REFUSED_PROBLEM_TYPE) return [];
  return (problem.errors ?? []).map((reason) => ({ code: reason.code, message: reason.detail }));
}

// ---- where a step stands, for the modal that offers it --------------------------------------------

/**
 * Every readiness answer the status-change modal holds at once, so one function can say where any
 * step stands instead of the template asking three different questions in three different shapes.
 *
 * Each pair is the answer and whether the read failed, and the two are not the same: a rule that
 * refused and a question nobody could put are different facts, and only the first is one a person
 * can act on.
 */
export interface MatterLifecycleReadiness {
  readonly close: MatterCloseReadiness | null;
  readonly closeFailed: boolean;
  readonly open: MatterOpenReadiness | null;
  readonly openFailed: boolean;
  readonly graduate: MatterGraduateReadiness | null;
  readonly graduateFailed: boolean;
}

/** Nothing asked and nothing answered: what the modal holds before its reads come back. */
export const NO_LIFECYCLE_READINESS: MatterLifecycleReadiness = {
  close: null,
  closeFailed: false,
  open: null,
  openFailed: false,
  graduate: null,
  graduateFailed: false,
};

/** Where one step stands right now: what it requires, whether that is met, and the line saying so. */
export interface MatterStepStanding {
  /**
   * One row per rule, already answered. Empty for a step no rule gates — the release, the reopen
   * and the pause — where the step's own consequence is the whole of what there is to read.
   */
  readonly requirements: readonly MatterCloseRequirementStatus[];
  /** Whether the rules have refused the step. An unanswered question is never a refusal. */
  readonly refused: boolean;
  /** Whether the answer could not be had at all, so taking the step is what will ask. */
  readonly unanswered: boolean;
  /** The one line the step's row carries before it is chosen. */
  readonly summary: string;
}

const NOTHING_IN_THE_WAY = "Nothing stands in the way.";
const STILL_CHECKING = "Checking what this requires.";
const COULD_NOT_CHECK = "This could not be checked. Taking the step will check it.";

/**
 * Where a step stands, from the answers the modal holds.
 *
 * The three gated steps answer in two different shapes — the close has a fixed roster of rules to
 * state as MET, while the open and the intake's completion have only whatever the firm's own
 * procedure refused — and this is where that difference stops being the template's problem. Both
 * come out as rows that are never empty while the step is gated, so the modal renders one structure
 * rather than a sentence opposite a list.
 */
export function matterStepStanding(
  step: MatterLifecycleStep,
  readiness: MatterLifecycleReadiness,
): MatterStepStanding {
  switch (step.action) {
    case "close": {
      const rows = matterCloseRequirements(readiness.close, readiness.closeFailed);
      return standing(rows, matterCanClose(readiness.close) === false, readiness.closeFailed);
    }
    case "open":
      return proceduralStanding(
        matterOpenRequirements(readiness.open, readiness.openFailed),
        readiness.open === null,
        readiness.openFailed,
        matterCanOpen(readiness.open) === false,
        "Nothing in the firm's intake procedure is outstanding.",
      );
    case "graduate":
      return proceduralStanding(
        matterGraduateRequirements(readiness.graduate, readiness.graduateFailed),
        readiness.graduate === null,
        readiness.graduateFailed,
        matterCanGraduate(readiness.graduate) === false,
        "Every step the firm's intake procedure requires is answered.",
      );
    // The pause, its release and the reopen have no rules of their own: nothing gates them but the
    // permission, which is a different sentence and is answered by matterLifecycleBlock.
    default:
      return { requirements: [], refused: false, unanswered: false, summary: NOTHING_IN_THE_WAY };
  }
}

function standing(
  rows: readonly MatterCloseRequirementStatus[],
  refused: boolean,
  unanswered: boolean,
): MatterStepStanding {
  if (unanswered) return { requirements: rows, refused, unanswered, summary: COULD_NOT_CHECK };
  if (rows.some((row) => row.state === "checking")) {
    return { requirements: rows, refused, unanswered, summary: STILL_CHECKING };
  }
  const unmet = rows.filter((row) => row.state === "unmet").length;
  return {
    requirements: rows,
    refused,
    unanswered,
    summary: unmet === 0 ? NOTHING_IN_THE_WAY : unmetSentence(unmet),
  };
}

/**
 * A step gated by the firm's own procedure rather than by a roster this build knows. There is
 * nothing to state as met until the answer arrives, so the met case is ONE row saying so — which
 * keeps the modal rendering a list in every state instead of prose opposite a list.
 */
function proceduralStanding(
  refusals: readonly MatterOpenRequirementStatus[],
  waiting: boolean,
  unanswered: boolean,
  refused: boolean,
  metLabel: string,
): MatterStepStanding {
  if (unanswered) {
    return {
      requirements: [{ key: "procedure", label: metLabel, state: "unknown", detail: null }],
      refused,
      unanswered,
      summary: COULD_NOT_CHECK,
    };
  }
  if (waiting) {
    return {
      requirements: [{ key: "procedure", label: metLabel, state: "checking", detail: null }],
      refused,
      unanswered,
      summary: STILL_CHECKING,
    };
  }
  if (refusals.length === 0) {
    return {
      requirements: [{ key: "procedure", label: metLabel, state: "met", detail: null }],
      refused,
      unanswered,
      summary: NOTHING_IN_THE_WAY,
    };
  }
  return {
    requirements: refusals.map((row) => ({ ...row, detail: null })),
    refused,
    unanswered,
    summary: unmetSentence(refusals.length),
  };
}

// Spelled for one and counted past it: "One requirement is not met." reads as a sentence, and
// beyond that the figure is what a reader is actually taking in.
function unmetSentence(count: number): string {
  return count === 1 ? "One requirement is not met." : `${String(count)} requirements are not met.`;
}

// ---- the physical file ------------------------------------------------------------------------

/**
 * The firm's own paper file for this matter: where it is kept, and when it may be destroyed.
 *
 * IT IS A STANDING FACT, NOT A CONSEQUENCE OF CLOSING. A firm keeps a matter's folder in a box,
 * commonly with other matters' folders, commonly at a remote store, and closing the matter moves
 * none of that. So this is not the "and then what happens" half of a close; it is what is true
 * about the file whatever the matter's status is, which is why it sits beside the status rather
 * than under the step.
 *
 * NONE OF IT IS THE CUSTODY REGISTER. Custodian holds CLIENT property left with the firm to guard —
 * an original will, a deed, a passport — which stays in the register for as long as the client's
 * affairs need it, long after the matter that brought it in has closed. The firm's own file is a
 * different object with a different life.
 *
 * LOCATION AND DESTROY AFTER ARE SERVED; HELD IN IS NOT. Where the file is kept is one of the
 * firm's own offices, a record the product already holds, so it resolves to that record and links
 * to it rather than being free text nobody can follow. It is NOT the office the matter is run out
 * of: a folder travels, and a matter opened at one office is commonly boxed at another or at a
 * remote store the firm keeps as an office of its own.
 *
 * "Destroy After" is a date a person at the firm states and nothing else. The platform derives
 * none — a retention period is the jurisdiction's and the firm's, and a date invented here would be
 * a date somebody destroys a client's file on — and nothing deletes anything when it arrives. It is
 * a reminder: here, and on the firm calendar's File Destruction Dates. The custody register is
 * explicit about the same posture for client property — an original is destroyed on a written
 * basis, by two people, never because a date arrived.
 *
 * "Held In" holds nothing yet, and there is nothing behind it to invent from: one container holds
 * several matters' folders, so it is a record of its own that does not exist. It renders, holding
 * nothing, marked Soon: the shape of the answer, never an invented one.
 *
 * An unserved row carries no sentence naming the dependency (owner ruling): a row that says "Not
 * recorded" beside the Soon mark has already said it is not built, and a paragraph repeating that
 * under three rows was the loudest copy on a window whose whole point is to be short.
 */
export interface MatterPhysicalFileFact {
  readonly key: string;
  readonly label: string;
  /**
   * Whether the record carries this fact. False renders the row holding nothing behind the Soon
   * mark; it is a property of the row rather than a branch in the template so the set of rows that
   * are real is one list with one test, and turning a row on is a word here.
   */
  readonly served: boolean;
}

/**
 * The rows.
 *
 * "Held In" names the thing the folder physically sits inside and deliberately does not say what
 * kind of thing that is. Firms do not agree: a box at a remote store, a drawer in a cabinet, a
 * safe, a shelf, a crate. A row called Box would have decided that for every firm, and the register
 * behind it will carry the medium as a fact of the container rather than as a word this screen
 * assumed. It is its own row rather than part of Location for the same reason it will be its own
 * record: one container holds the folders of several matters, so a matter points at it.
 */
export const MATTER_PHYSICAL_FILE_FACTS: readonly MatterPhysicalFileFact[] = [
  { key: "location", label: "Location", served: true },
  { key: "container", label: "Held In", served: false },
  { key: "destroy-after", label: "Destroy After", served: true },
];

// ---- the destruction date the close asks for --------------------------------------------------

/**
 * The earliest date a matter closing on `closedOn` may name for its paper file's destruction,
 * under the firm's minimum retention in whole years; null where the firm states no minimum.
 *
 * The same rule the server applies (packages/matters/src/matter-file-retention.ts), stated here so
 * the close can offer the floor as its starting answer and refuse a date under it before the press.
 * The server still has the last word. A close on 29 February rolls forward to 1 March, so the floor
 * is never a day short of the period the firm set.
 */
export function earliestFileDestructionDate(closedOn: string, minimumYears: number): string | null {
  if (minimumYears <= 0) return null;
  const { year, month, day } = civilDateParts(closedOn);
  const targetYear = year + minimumYears;
  const monthEnd = endOfCivilMonth(targetYear, month);
  return day <= Number(monthEnd.slice(8, 10))
    ? civilDateFromParts({ year: targetYear, month, day })
    : addCalendarDays(monthEnd, 1);
}

/**
 * Why the close cannot record the destruction date it was given, or null where it can. `destroyOn`
 * null is "No destruction date", which is always an answer; an empty string is a date not chosen.
 */
export function fileDestructionDateRefusal(
  destroyOn: string | null,
  earliest: string | null,
): string | null {
  if (destroyOn === null) return null;
  if (destroyOn.trim() === "") {
    return "Choose the date the paper file may be destroyed after, or No Destruction Date.";
  }
  if (earliest !== null && destroyOn < earliest) {
    return `The firm keeps a closed matter's paper file until at least ${earliest}.`;
  }
  return null;
}

// ---- what stops the step being taken from this screen ---------------------------------------------

/**
 * Why the step cannot be taken from this screen, or nothing where it can.
 *
 * The three answers are different and a person can act on exactly one of them, so they are never
 * collapsed into a single "unavailable". A sample matter is a fixture with no record behind it; a
 * missing permission is an account question for whoever administers the firm; a session still being
 * read is a wait.
 */
/**
 * Why a sample matter's status cannot be changed. Its own sentence rather than one written twice,
 * because the window that states it and the panel that offers the steps have to say it the same way.
 */
export const SAMPLE_MATTER_STATUS_SENTENCE =
  "This is a sample matter, not one of the firm's. Its status is fixed so every lifecycle state stays reviewable.";

export function matterLifecycleBlock(options: {
  readonly step: MatterLifecycleStep;
  readonly isSample: boolean;
  /** Whether the session read has come back at all, either way. */
  readonly sessionSettled: boolean;
  /** The permissions it answered with, or null where the read itself failed. */
  readonly permissions: readonly string[] | null;
}): string | null {
  if (options.isSample) return SAMPLE_MATTER_STATUS_SENTENCE;
  if (!options.sessionSettled) return "Reading your session.";
  // A session that could not be read is UNKNOWN, not unprivileged, and the two must not be said the
  // same way. Blocking here would refuse somebody who holds the permission, on the strength of a
  // failed read; the server checks the same permission and answers in its own words, so the step
  // stays offered and the refusal, if there is one, comes from the authority on it.
  if (options.permissions === null) return null;
  if (!options.permissions.includes(options.step.permission)) {
    return permissionRefusal("This step", options.step.permission);
  }
  return null;
}
