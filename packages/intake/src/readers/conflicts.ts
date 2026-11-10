import { readMatterConflictsPosture } from "@magna-carta/conflicts/posture";
import type { IntakeStepReader } from "../checklist.ts";

// The conflicts-check step, answered by the matter's conflicts posture and by nothing else.
//
// A STEP ON PROCEDURE, NEVER ON A VERDICT. The four conditions below are the four the posture read
// already computes and every one is a fact about the firm's own procedure: the firm has not looked,
// the firm looked less thoroughly than it now requires, something surfaced and nobody answered it,
// the corpus moved and the answer has not been re-derived. Satisfying all four says the procedure
// was followed; it says nothing about whether a conflict exists, because the platform never
// concludes that and this reader repeats the posture's own facts rather than summarising them.
export const conflictsCheckStepReader: IntakeStepReader = async ({ database, matterId }) => {
  const posture = await readMatterConflictsPosture(database, matterId);
  if (posture.neverChecked) {
    return { satisfied: false, statement: "A conflicts check has not yet run on this matter." };
  }
  const shortfall = posture.scopeShortfall;
  if (shortfall.sources.length > 0 || shortfall.strictness !== null) {
    return {
      satisfied: false,
      statement:
        "The latest check ran below the firm's current floor; a check at the floor is owed.",
    };
  }
  const undisposed = posture.undisposedByTier.reduce((sum, tier) => sum + tier.count, 0);
  if (undisposed > 0) {
    return {
      satisfied: false,
      statement:
        undisposed === 1
          ? "One surfaced hit has no answer from a reviewer."
          : `${String(undisposed)} surfaced hits have no answer from a reviewer.`,
    };
  }
  if (posture.pendingRecheck.length > 0) {
    return {
      satisfied: false,
      statement:
        posture.pendingRecheck.length === 1
          ? "A re-check is owed: the firm's record changed after the latest check."
          : `${String(posture.pendingRecheck.length)} re-checks are owed: the firm's record changed after the latest check.`,
    };
  }
  const latest = posture.latestCheck;
  const hits = latest?.hitCount ?? 0;
  return {
    satisfied: true,
    statement:
      hits === 0
        ? `A check ran on ${(latest?.createdAt ?? "").slice(0, 10)} at the firm's floor. 0 results.`
        : `A check ran on ${(latest?.createdAt ?? "").slice(0, 10)} at the firm's floor; ${String(hits)} ${hits === 1 ? "hit" : "hits"} surfaced and every one has a reviewer's answer.`,
  };
};
