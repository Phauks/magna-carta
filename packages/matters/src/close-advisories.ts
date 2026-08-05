import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId } from "@magna-carta/identifiers/types";

// The close-advisory hook: the sibling of the close-precondition hook, and deliberately a SEPARATE
// mechanism rather than a precondition with a softer flag.
//
// A precondition answers "may this matter close?" and a failure stops the close. An advisory answers
// "what should the person closing it know?" and CANNOT stop anything: it returns notices that ride
// the successful close response, and there is no path by which one becomes a refusal. Keeping them
// apart is the point. One boolean away from each other, a subsystem that only meant to inform starts
// blocking closes on a Friday afternoon, and the firm learns to route around the close screen.
//
// The registry below is EMPTY and stays empty, for the same reason the precondition registry is: a
// notice belongs to the subsystem that owns the thing it describes, and the composition root passes
// it in. The matter shell never learns what property or money is.
export interface CloseAdvisoryContext {
  readonly matterId: MatterId;
  readonly database: SqlDatabase;
}

export interface CloseAdvisoryNotice {
  readonly code: string;
  readonly message: string;
}

export interface CloseAdvisory {
  // Reads the current state and reports what the person closing the matter should know. It has no
  // guard and no in-batch statement: an advisory changes nothing and gates nothing, so there is no
  // window for a concurrent writer to invalidate.
  notice(context: CloseAdvisoryContext): Promise<readonly CloseAdvisoryNotice[]>;
}

export const CLOSE_ADVISORIES: readonly CloseAdvisory[] = [];

export async function collectCloseAdvisories(
  context: CloseAdvisoryContext,
  advisories: readonly CloseAdvisory[] = CLOSE_ADVISORIES,
): Promise<CloseAdvisoryNotice[]> {
  const notices: CloseAdvisoryNotice[] = [];
  for (const advisory of advisories) {
    notices.push(...(await advisory.notice(context)));
  }
  return notices;
}
