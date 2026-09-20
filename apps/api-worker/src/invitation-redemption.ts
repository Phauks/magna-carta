import type { Context } from "hono";
import { attemptLadderKey, type AttemptBudget, type AttemptLadder } from "./auth-attempt-budget.ts";
import { problemJson, type ProblemResponse } from "./contracts/problem.ts";
import {
  digestsMatch,
  invitationCodeHash,
  invitationVerifierHash,
  UNMATCHABLE_VERIFIER_HASH,
} from "./joining-secrets.ts";

// REDEEMING AN INVITATION — the lookup, the two budgets and the ONE refusal, in one place because
// there are two routes that redeem and there must not be two answers.
//
// The anonymous route (routes/session/invitations.ts) creates the account as it redeems. The signed-in route
// (routes/session/onboarding.ts) attaches the firm to an account that already exists, which is what joining
// looks like once a person makes their account first. What differs is the WRITE. Everything before
// it — which facts are compared, in what order, against what when nothing is found, what is spent,
// and what a failure says — is identical by construction here rather than by two authors agreeing.
//
// EVERY WRONG COMBINATION IS ONE MESSAGE, and the storage shape is what guarantees it: the row holds
// a single digest over the code, the surname and the date of birth together, so there is no separate
// surname to compare and no separate birthday, and a caller cannot be told which one was wrong. A
// form that answered "the code is right but the date of birth is not" is a machine for confirming
// that a named person was invited to a named firm, which for a law firm's client list is the
// confidential fact itself.
//
// TWO BUDGETS, ONE SPOKEN ALOUD. The caller's ladder bounds breadth and is the only number that
// reaches the body — the caller already knows it and it does not move with what the lookup found.
// The invitation's own counter bounds DEPTH against a code somebody genuinely holds, and stays
// silent: a refusal that published it would answer the one question this route exists to refuse.

/** How many redemption attempts one invitation allows before it locks itself. */
export const INVITATION_ATTEMPT_LIMIT = 5;

/** How long an invitation stays locked once its attempts are spent. */
export const INVITATION_LOCKOUT_SECONDS = 900;

// The single sentence every failed redemption gets, whatever went wrong.
const NEUTRAL_REDEMPTION_DETAIL =
  "That invitation could not be redeemed. Check the code, surname and date of birth against the " +
  "invitation, or ask the firm that invited you to send a new one.";

// An invitation id no row can hold, for the balancing write below. Every id is a generated
// identifier, so the empty string matches nothing — the same device as UNMATCHABLE_VERIFIER_HASH,
// applied to a write instead of a comparison.
const UNMATCHABLE_INVITATION_ID = "";

export interface InvitationRow {
  readonly id: string;
  readonly firm_id: string;
  readonly kind: string;
  readonly email: string;
  readonly display_name: string;
  readonly verifier_hash: string;
  readonly status: string;
  readonly attempt_count: number;
  readonly locked_until: string | null;
  readonly expires_at: string;
}

/**
 * THE refusal — the one and only construction of a failed redemption's answer, for both routes.
 *
 * Everything in it is a constant except the budget, and the budget comes from the caller's own
 * ladder, which the caller already knows and which does not move when the lookup finds something.
 * Nothing read off an invitation row may be passed in here: a value that varies with what was found
 * is an oracle whatever the sentence beside it says.
 */
export function neutralRedemptionRefusal(c: Context, budget: AttemptBudget): ProblemResponse<422> {
  return problemJson(c, {
    type: "invitation-not-redeemable",
    status: 422,
    title: "That invitation could not be redeemed",
    detail: NEUTRAL_REDEMPTION_DETAIL,
    attemptsRemaining: budget.remaining,
    ...(budget.lockoutSecondsRemaining !== null && {
      retryAfterSeconds: budget.lockoutSecondsRemaining,
    }),
  });
}

export interface RedemptionAttempt {
  readonly code: string;
  readonly lastName: string;
  readonly dateOfBirth: string;
}

export type RedemptionOutcome =
  | { readonly kind: "refused"; readonly response: ProblemResponse<422> }
  | { readonly kind: "matched"; readonly invitation: InvitationRow };

/**
 * Resolve the three presented facts against the invitation register, spending both budgets and
 * building the one refusal. A `matched` outcome hands back the row for the caller's own write; the
 * caller is responsible for clearing the ladder once that write commits.
 *
 * `ladderKeyOverride` lets the signed-in route key the caller's budget by SESSION rather than by
 * address: an authenticated caller is identified, so charging their attempts to a shared office
 * address would let one person spend their colleagues' budget. Both keys live in the same ladder,
 * which is what keeps one person from getting a second allowance by signing in.
 */
export async function resolveInvitationRedemption(
  c: Context,
  controlPlaneDatabase: D1Database,
  ladder: AttemptLadder,
  attempt: RedemptionAttempt,
  ladderKeyOverride?: string,
): Promise<RedemptionOutcome> {
  const nowInstant = new Date().toISOString();
  const ladderKey = ladderKeyOverride ?? attemptLadderKey(c);

  // The caller's ladder, read before anything is looked up. A caller whose own budget is spent is
  // refused here, and this return is decided ENTIRELY by caller state — no code has been hashed and
  // no row has been read — so it cannot vary with what an invitation row would have said. Refusing
  // before the lookup also stops a locked-out prober from continuing to burn a real invitation's
  // attempts on the way past.
  const standing = ladder.read(ladderKey);
  if (standing.lockoutSecondsRemaining !== null) {
    return { kind: "refused", response: neutralRedemptionRefusal(c, standing) };
  }

  // BOTH digests are computed BEFORE anything is looked up, and both are computed on every path.
  // The point is that the work this function does must not depend on what it finds: a wrong code
  // and a wrong birthday take the same two hashes and the same one comparison.
  const [codeHash, presentedVerifier] = await Promise.all([
    invitationCodeHash(attempt.code),
    invitationVerifierHash({
      code: attempt.code,
      lastName: attempt.lastName,
      dateOfBirth: attempt.dateOfBirth,
    }),
  ]);

  const row = await controlPlaneDatabase
    .prepare(
      "SELECT id, firm_id, kind, email, display_name, verifier_hash, status, attempt_count, " +
        "locked_until, expires_at FROM invitation WHERE code_hash = ?1",
    )
    .bind(codeHash)
    .first<InvitationRow>();

  // The comparison runs even with no row, against a digest nothing can equal. An early return here
  // would make "no such code" measurably faster than "wrong date of birth", which is the same
  // oracle rebuilt out of a stopwatch instead of a status code.
  const verifierMatches = digestsMatch(
    row?.verifier_hash ?? UNMATCHABLE_VERIFIER_HASH,
    presentedVerifier,
  );
  const locked = row !== null && row.locked_until !== null && row.locked_until > nowInstant;
  const live = row !== null && row.status === "pending" && row.expires_at > nowInstant;

  if (!verifierMatches || !live || locked) {
    // The invitation's own ladder, spent when a real, live invitation was aimed at and missed. It
    // is what bounds DEPTH against a code somebody genuinely holds.
    const spendingRow = row !== null && live && !locked ? row : null;
    const spent = spendingRow !== null ? spendingRow.attempt_count + 1 : 0;
    const lockedUntil =
      spendingRow !== null && spent >= INVITATION_ATTEMPT_LIMIT
        ? new Date(Date.now() + INVITATION_LOCKOUT_SECONDS * 1000).toISOString()
        : null;
    // ONE write on every refusal, whatever was found. When there is nothing to spend against, the
    // same statement runs against an id no row holds: zero rows changed, one round trip to the
    // control plane, the same cost. A conditional write would leave the difference the body no
    // longer carries sitting in a stopwatch instead — the same reasoning as comparing against the
    // unmatchable digest rather than returning early.
    await controlPlaneDatabase
      .prepare("UPDATE invitation SET attempt_count = ?2, locked_until = ?3 WHERE id = ?1")
      .bind(spendingRow?.id ?? UNMATCHABLE_INVITATION_ID, spent, lockedUntil)
      .run();

    return { kind: "refused", response: neutralRedemptionRefusal(c, ladder.spend(ladderKey)) };
  }

  // Past here the row is non-null and every fact matched.
  return { kind: "matched", invitation: row };
}
