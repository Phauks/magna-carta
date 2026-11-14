/*
 * From a failure record to the props the design-system failure components take.
 *
 * This is the piece that keeps a surface's failure branch to one line. Before it existed, every
 * surface assembled the same four rows and the same trace by hand — which is why most of them
 * assembled three of the four and dropped the Error ID, and why the two that did it properly had
 * drifted from each other by the time anybody compared them.
 */
import type { Failure } from "$lib/api/problem.ts";
import type { FailureDetailRow } from "@magna-carta/design-system/failure-details";
import { formatInstant } from "@magna-carta/design-system/formatters";
import { areaForPath, failurePath } from "./failure-summary.ts";

/** The facts a reader scans, in the order they answer "what failed, why, and when". */
export function failureRows(failure: Failure): FailureDetailRow[] {
  const problem = failure.problem;
  const area = areaForPath(failurePath(failure));
  const cause = failure.cause ?? problem?.cause;
  return [
    ...(area === null ? [] : [{ label: "Area", value: area }]),
    { label: "Request", value: failure.request, mono: true },
    {
      label: "Answer",
      value:
        problem === null
          ? "Couldn't connect"
          : problem.title === undefined
            ? String(problem.status)
            : `${String(problem.status)} ${problem.title}`,
    },
    ...(cause === undefined ? [] : [{ label: "Cause", value: cause, mono: true }]),
    { label: "Time", value: formatInstant(failure.failedAt) },
    { label: "Error ID", value: problem?.errorId ?? "None issued", mono: true },
  ];
}

/**
 * The ordered remedy a screen-scale failure ends on. Generic on purpose: the specific advice belongs
 * in the message, and a numbered list that repeats it is noise. The last step is the only one that
 * reaches a person, so it is always last.
 */
export const STANDARD_REMEDY_STEPS: readonly string[] = [
  "Retry: a brief interruption usually clears on the next read.",
  "Check your connection, and whether the rest of the screen still loads.",
  "If it keeps failing, report it with the Error ID above.",
];

/**
 * A failure plus the surface's own words for it.
 *
 * ONE VARIABLE OFTEN HOLDS TWO DIFFERENT FAILURES. A pane where both "record a name" and "change a
 * name" report into the same slot had a different sentence for each, and those sentences said
 * genuinely different things — "the name was not recorded" is a fact about what happened, where "the
 * name could not be changed" describes an attempt. Flattening them to one per-surface fallback would
 * lose that, so the words travel with the failure rather than with the surface.
 */
export interface StatedFailure {
  readonly failure: Failure;
  /** What to say where the server sent no words of its own. */
  readonly fallback: string;
  /** What to say when NOTHING answered, where that is a stronger statement than the refusal. */
  readonly whenSilent?: string;
}

/** Pair a failure with the words this particular action wants said about it. */
export function stated(failure: Failure, fallback: string, whenSilent?: string): StatedFailure {
  return { failure, fallback, whenSilent };
}
