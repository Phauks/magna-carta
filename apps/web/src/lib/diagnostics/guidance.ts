/*
 * From a failure to the words a person reads, and the one control that moves them forward.
 *
 * PURE, AND TESTED AS SUCH. On the joining screens the wording is a security decision rather than a
 * copy decision — a sentence that distinguishes "no such invitation" from "wrong date of birth" is a
 * machine for confirming that a named person was invited to a named firm — so the mapping is a
 * function over data, unit-tested, and not something that can be quietly altered by editing a
 * template.
 *
 * THE DEFAULT IS A FLOOR, NEVER A CEILING. Every surface may override the sentence for its own
 * channel, and several must: the standing ruling in docs/conventions/design-corrections.md is that
 * error copy is per-channel and specific, because one generic message across channels that fail
 * differently is wrong. What this module guarantees is that nothing ever renders blank, and that the
 * cases the platform already learned about the hard way are handled the same everywhere.
 */
import type { Failure, Problem } from "$lib/api/problem.ts";

export type ProblemTone = "info" | "warning" | "danger";

/**
 * The one control a failure offers, chosen from what the server said rather than from what the
 * surface guesses. `none` is a real answer: a refusal nobody can retry their way out of should not
 * grow a button that does nothing (the no-dead-controls rule).
 */
export type Remedy =
  | { readonly kind: "retry" }
  | { readonly kind: "retryAfter"; readonly seconds: number }
  | { readonly kind: "stepUp" }
  | { readonly kind: "requestAccess" }
  | { readonly kind: "signIn" }
  | { readonly kind: "none" };

export interface ProblemGuidance {
  readonly tone: ProblemTone;
  /** A short name for the failure, suitable as a heading. Sentence case, never punctuated. */
  readonly title: string;
  /** What happened and what it means, in words a reader can act on. */
  readonly message: string;
  readonly remedy: Remedy;
  /**
   * A second line stating a fact the member needs and the message has no room for — how many
   * attempts remain, at present. Absent unless the server published one.
   */
  readonly note?: string;
}

/**
 * A 404 is two different failures wearing one status, and telling them apart is the whole job.
 *
 * A RECORD THAT IS NOT THERE answers with a real problem document: a registered `type` and an
 * `errorId`, because every problem the API composes carries both. That is an ordinary answer — the
 * matter was deleted, the link is stale — and it is the member's to act on.
 *
 * A ROUTE THAT IS NOT THERE answers with neither, because nothing in the API composed it: the app
 * only ever calls paths it was built against, so a path the service does not recognise means the
 * interface and the API are on different releases. They deploy as separate Workers, so a fresh page
 * can meet an older API for a few minutes after a release.
 *
 * Getting this backwards has already cost a round: a skew 404 read as "that is not a valid address"
 * and blamed the member for a deploy. Getting it backwards the OTHER way would be worse — every
 * legitimately missing record would claim the platform was updating.
 */
export function isServiceSkew(problem: Problem): boolean {
  return problem.status === 404 && problem.type === undefined && problem.errorId === undefined;
}

export const SERVICE_SKEW_TITLE = "The service is mid-update";
const SERVICE_SKEW_MESSAGE = "Magna Carta was just updated. Reload the page in a moment.";

/** Nothing answered at all: not a refusal, and not a verdict on anything the member did. */
const NO_ANSWER_TITLE = "Couldn't connect";
const NO_ANSWER_MESSAGE =
  "The request did not reach Magna Carta, or the answer never arrived. Check your connection, " +
  "then try again.";

function attemptNote(problem: Problem): string | undefined {
  const remaining = problem.attemptsRemaining;
  if (remaining === undefined) return undefined;
  if (remaining === 0) return "No attempts remain.";
  if (remaining === 1) return "One attempt remains.";
  return `${remaining} attempts remain.`;
}

/**
 * The remedy a problem names, in the order the member should be offered them: a step-up or an access
 * request is a way THROUGH, so it outranks a retry, which is only a way round. A lockout window
 * outranks a plain retry so the control can say when rather than fail again immediately.
 */
function remedyFor(problem: Problem): Remedy {
  if (problem.stepUpRequired === true) return { kind: "stepUp" };
  if (problem.requestAccess === true) return { kind: "requestAccess" };
  if (problem.status === 401) return { kind: "signIn" };
  if (problem.retryAfterSeconds !== undefined && problem.retryAfterSeconds > 0) {
    return { kind: "retryAfter", seconds: problem.retryAfterSeconds };
  }
  // A server fault, a timeout, or a conflict a moment may resolve. Everything else is an answer:
  // retrying a 403 or a 422 produces the same refusal and teaches the member nothing.
  if (problem.status >= 500 || problem.status === 408 || problem.status === 409) {
    return { kind: "retry" };
  }
  return { kind: "none" };
}

/**
 * The default guidance for one failure. `subject` names what could not be read or done, in the
 * words the surface uses for it — "The costs", "This matter's parties" — and is used only where the
 * server gave no sentence of its own.
 */
export function guidanceFor(failure: Failure, subject = "That"): ProblemGuidance {
  return guidanceForProblem(failure.problem, subject);
}

/**
 * The same mapping over a bare problem, for the surfaces whose own guidance overrides parts of it.
 * A null problem is the "nothing answered" case, which is a different thing to a refusal and says
 * so.
 */
export function guidanceForProblem(problem: Problem | null, subject = "That"): ProblemGuidance {
  if (problem === null) {
    return {
      tone: "danger",
      title: NO_ANSWER_TITLE,
      message: NO_ANSWER_MESSAGE,
      remedy: { kind: "retry" },
    };
  }

  const note = attemptNote(problem);

  if (isServiceSkew(problem)) {
    return {
      tone: "warning",
      title: SERVICE_SKEW_TITLE,
      message: SERVICE_SKEW_MESSAGE,
      remedy: { kind: "retry" },
    };
  }

  if (problem.status === 404) {
    return {
      tone: "warning",
      title: problem.title ?? "That is no longer here",
      message:
        problem.detail ??
        `${subject} could not be found. It may have been deleted, or the link may be stale.`,
      remedy: { kind: "none" },
      note,
    };
  }

  if (problem.stepUpRequired === true) {
    return {
      tone: "info",
      title: "Confirm it is you",
      message:
        problem.detail ??
        "This action needs a fresh sign-in before it can go ahead. Nothing has been changed.",
      remedy: { kind: "stepUp" },
      note,
    };
  }

  if (problem.requestAccess === true) {
    return {
      tone: "info",
      title: "You do not have access to this",
      message:
        problem.detail ?? "This is restricted. You can ask the person responsible for access.",
      remedy: { kind: "requestAccess" },
      note,
    };
  }

  if (problem.status === 401) {
    return {
      tone: "info",
      title: "You are signed out",
      message: "Your session has ended. Sign in again and you will come back to this page.",
      remedy: { kind: "signIn" },
      note,
    };
  }

  if (problem.status === 403) {
    return {
      tone: "warning",
      title: "You do not have permission",
      message: problem.detail ?? `${subject} is not something your account is allowed to reach.`,
      remedy: { kind: "none" },
      note,
    };
  }

  // Not a verdict on what was entered. Saying "that was wrong" here would tell somebody a correct
  // answer was incorrect purely because they were quick.
  if (problem.status === 429) {
    const seconds = problem.retryAfterSeconds;
    return {
      tone: "warning",
      title: "Too many attempts",
      message:
        seconds === undefined
          ? "Wait a moment, then try again. Nothing was changed."
          : "Wait a moment, then try again. Nothing was changed, and nothing you sent was wrong.",
      remedy: remedyFor(problem),
      note,
    };
  }

  // A refusal the server described in its own words. The detail is the best sentence available and
  // is server-authored, never a raw exception, so it is preferred over anything invented here.
  if (problem.status < 500) {
    return {
      tone: "danger",
      title: problem.title ?? `${subject} could not be completed`,
      message:
        problem.detail ?? `${subject} was refused, and the server did not say more than that.`,
      remedy: remedyFor(problem),
      note,
    };
  }

  // A server fault says nothing whatever about the request. It gets a sentence that does not imply
  // the member did anything, and the Error ID that makes it traceable.
  return {
    tone: "danger",
    title: problem.title ?? `${subject} could not be read`,
    message:
      problem.detail ??
      "Something went wrong on our side. The failure has been recorded against the ID below.",
    remedy: { kind: "retry" },
    note,
  };
}

/**
 * Whether a failure is evidence that the PLATFORM is unwell rather than this one read. Deploy skew
 * and a service fault are about Magna Carta; a refusal is about the request. Counting these across a
 * screen is what lets the shell say the true thing once instead of six panels apologising
 * separately.
 */
export function indicatesPlatformTrouble(failure: Failure): boolean {
  if (failure.problem === null) return true;
  return isServiceSkew(failure.problem) || failure.problem.status >= 500;
}
