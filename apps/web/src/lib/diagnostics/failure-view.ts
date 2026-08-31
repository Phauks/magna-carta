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

/** The facts a reader scans, in the order they answer "what failed, and when". */
export function failureRows(failure: Failure): FailureDetailRow[] {
  const problem = failure.problem;
  return [
    { label: "Request", value: failure.request, mono: true },
    { label: "Answer", value: problem === null ? "Nothing answered" : String(problem.status) },
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
