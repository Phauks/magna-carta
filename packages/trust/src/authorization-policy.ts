import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { TrustAuthorizationPolicyId, UserId } from "@magna-carta/identifiers/types";
import type { TrustServiceOptions } from "./account-tree.ts";
import {
  insertTrustAuthorizationPolicyStatement,
  selectActiveTrustAuthorityHoldersStatement,
  selectActiveTrustManagersStatement,
  selectCurrentTrustAuthorizationPolicyStatement,
  selectTrustAuthorizationPolicyHistoryStatement,
  selectTrustAuthorizationPolicyStatement,
} from "./statements.ts";
import { TrustValidationError } from "./trust-validation.ts";
import type {
  TrustAuthorizationPolicyKind,
  TrustAuthorizationPolicySnapshot,
  TrustDisbursementAuthorizationBasis,
} from "./types.ts";

// THE FIRM'S DISBURSEMENT-AUTHORIZATION POLICY — whether money leaving a client ledger takes a
// second person, and whether whoever lets it go must hold the authority capability. One policy, two
// consumers: the disbursement approval flow (disbursement-authorization.ts) and the earned-fee
// transfer (transfer.ts, and through it billing's application path) both answer "does this amount
// take a second person" through `trustAuthorizationRequiresSecondPerson` below, and the triggers in
// the per-firm migration hold the same predicate at the database — a route is one code path among
// several that reach those tables.
//
// AN ABSENT ROW IS THE STRICT POSTURE, AND EVERY FIRM DATABASE IS SEEDED WITH ONE. Two different
// facts, deliberately kept apart. `SHIPPED_TRUST_AUTHORIZATION_POLICY` below is what a NULL stamp
// resolves to — always two-person, no authority requirement — and it describes the requests
// submitted before any posture existed, forever. What a new firm actually starts with is a seeded
// version 1 (`off` plus the authority requirement: an authority holder acts alone, anybody else
// routes to one), written by the per-firm migration
// `20260808T020000_trust-authority-default-posture.sql` as an ordinary append-only version row a
// firm can read, supersede, and audit. Keeping the default as DATA rather than as a re-reading of
// the absent row is what leaves every trigger untouched and stops the NULL stamp changing meaning
// underneath the history it records.
//
// THE AUTHORITY FLAG BINDS WHOEVER LETS MONEY GO, which is what makes an amount-only exemption
// actor-conditional: with it set, an amount no second person is required for can still only be
// released by a holder, and a non-holder's self-decision is refused — leaving the request pending
// for somebody who holds the authority. Peer approval above a threshold is the same rule seen from
// the other side: the decider IS the second person, and the flag binds the decider.
//
// A POSTURE CHANGE GOVERNS NEW AUTHORIZATIONS ONLY. Requests stamp the version current when they
// were submitted and are decided under that stamp — the triggers read the stamp, never the latest
// row — so a pending request keeps the rules it was created under, in both directions: relaxing the
// policy does not unlock a request submitted under the strict one, and tightening it does not strand
// a request the old policy exempted.

export const AUTHORIZATION_POLICY_CHANGED_AUDIT_EVENT = "trust.authorization_policy_changed";

// Version 0, no row, no id: what a NULL policy stamp resolves to. A firm database provisioned since
// the authority-based posture shipped is seeded with version 1 instead, so in practice this governs
// the requests and transfers stamped before any version existed — and it stays the strict reading,
// because that is what those rows were actually decided under.
export const SHIPPED_TRUST_AUTHORIZATION_POLICY: TrustAuthorizationPolicySnapshot = {
  id: null,
  version: 0,
  policy: "always",
  thresholdAmountMinor: null,
  requireAuthorizedApprover: false,
  setBy: null,
  setAt: null,
};

interface TrustAuthorizationPolicyRow {
  id: string;
  version: number;
  policy: TrustAuthorizationPolicyKind;
  threshold_amount_minor: number | null;
  require_authorized_approver: number;
  set_by: string;
  set_at: string;
}

function toPolicySnapshot(row: TrustAuthorizationPolicyRow): TrustAuthorizationPolicySnapshot {
  return {
    id: row.id as TrustAuthorizationPolicyId,
    version: row.version,
    policy: row.policy,
    thresholdAmountMinor: row.threshold_amount_minor,
    requireAuthorizedApprover: row.require_authorized_approver === 1,
    setBy: row.set_by as UserId,
    setAt: row.set_at,
  };
}

// The policy governing a NEW authorization: the latest version, or the shipped default when the firm
// has never written one. `.all()` + `results[0]`, never `.first()` — the one-row read convention (one sentinel for
// "no row"), stated in packages/data-access/src/idempotency-statements.ts.
export async function readCurrentTrustAuthorizationPolicy(
  database: SqlDatabase,
): Promise<TrustAuthorizationPolicySnapshot> {
  const { results } =
    await selectCurrentTrustAuthorizationPolicyStatement(
      database,
    ).all<TrustAuthorizationPolicyRow>();
  const row = results[0];
  return row ? toPolicySnapshot(row) : SHIPPED_TRUST_AUTHORIZATION_POLICY;
}

// The policy a STAMP resolves to: the named version, or the shipped default for a null stamp (a
// request submitted before any version existed). A stamp naming a missing row refuses loudly — it
// would mean a policy row was destroyed, which the append-only triggers exist to prevent.
export async function loadTrustAuthorizationPolicy(
  database: SqlDatabase,
  policyId: TrustAuthorizationPolicyId | null,
): Promise<TrustAuthorizationPolicySnapshot> {
  if (policyId === null) return SHIPPED_TRUST_AUTHORIZATION_POLICY;
  const { results } = await selectTrustAuthorizationPolicyStatement(
    database,
    policyId,
  ).all<TrustAuthorizationPolicyRow>();
  const row = results[0];
  if (!row) {
    throw new TrustValidationError(
      "unknown-trust-authorization-policy",
      `no such trust authorization policy version: ${policyId}`,
    );
  }
  return toPolicySnapshot(row);
}

// Every version the firm has written, newest first — who changed the posture, when, from what to
// what, read straight off the append-only rows.
export async function readTrustAuthorizationPolicyHistory(
  database: SqlDatabase,
): Promise<readonly TrustAuthorizationPolicySnapshot[]> {
  const { results } =
    await selectTrustAuthorizationPolicyHistoryStatement(
      database,
    ).all<TrustAuthorizationPolicyRow>();
  return results.map(toPolicySnapshot);
}

// THE predicate — the one answer to "does this amount take a second person under this policy",
// shared by the disbursement approval flow and the earned-fee transfer so the two can never drift.
// `threshold` requires a second person for amounts STRICTLY ABOVE the threshold: the policy states
// "the amount above which two-person applies", so an amount equal to it does not.
export function trustAuthorizationRequiresSecondPerson(
  policy: TrustAuthorizationPolicySnapshot,
  amountMinor: number,
): boolean {
  switch (policy.policy) {
    case "off":
      return false;
    case "always":
      return true;
    case "threshold":
      // The shape CHECK makes a threshold row without an amount unrepresentable; a null here would
      // mean the row lied, and refusing is safer than treating it as zero or as infinity.
      if (policy.thresholdAmountMinor === null) {
        throw new TrustValidationError(
          "trust-authorization-policy-malformed",
          "a threshold authorization policy carries no threshold amount",
        );
      }
      return amountMinor > policy.thresholdAmountMinor;
    default:
      // Unreachable under the type, load-bearing against data: a policy kind this code does not
      // recognize — a future value reaching an old deploy — must not resolve to "no second person
      // required". Refuse rather than waive, the same direction the triggers' exemption whitelists
      // take.
      throw new TrustValidationError(
        "trust-authorization-policy-malformed",
        `unrecognized authorization policy kind: ${String(policy.policy)}`,
      );
  }
}

// Which active members hold the authority capability — read to turn the authority triggers' aborts
// into refusals naming who CAN act. The triggers are the guarantee; this read cannot be atomic with
// the write it precedes.
export async function readActiveTrustAuthorityHolders(
  database: SqlDatabase,
): Promise<readonly { user_id: string; display_name: string }[]> {
  const { results } = await selectActiveTrustAuthorityHoldersStatement(database).all<{
    user_id: string;
    display_name: string;
  }>();
  return results;
}

// The named refusal in front of the authority triggers, for both consumers: when the governing
// policy requires authority, whoever lets money go must be an active member holding
// trust:authorize. Lists the holders, because "somebody with authority must act" is a refusal a firm
// cannot act on without knowing who that is.
export async function assertActorHoldsTrustAuthority(
  database: SqlDatabase,
  policy: TrustAuthorizationPolicySnapshot,
  actor: UserId,
): Promise<void> {
  if (!policy.requireAuthorizedApprover) return;
  const holders = await readActiveTrustAuthorityHolders(database);
  if (holders.some((holder) => holder.user_id === actor)) return;
  const named = holders.map((holder) => `${holder.display_name} (${holder.user_id})`).join(", ");
  throw new TrustValidationError(
    "trust-authorization-authority-required",
    holders.length === 0
      ? `this firm requires trust money movement to be authorized by a member with the authority to act (trust:authorize), and no active member holds it: grant the capability before authorizing`
      : `this firm requires trust money movement to be authorized by a member with the authority to act (trust:authorize); ${actor} does not hold it — it must be decided by one of: ${named}`,
  );
}

// Which active members hold the bookkeeping capability. Read to turn the lone-holder triggers'
// aborts into refusals naming who CAN act, and — like the authority read above — never the
// guarantee: the triggers count the same rows the same way, and a read cannot be atomic with the
// write it precedes. Deliberately counts a direct grant whether or not it has expired, because
// over-counting holders REFUSES the lone-holder exception, which is the safe direction to be wrong
// in.
export async function readActiveTrustManagers(
  database: SqlDatabase,
): Promise<readonly { user_id: string; display_name: string }[]> {
  const { results } = await selectActiveTrustManagersStatement(database).all<{
    user_id: string;
    display_name: string;
  }>();
  return results;
}

// THE LONE-HOLDER EXCEPTION, IN ONE PLACE. A firm with genuinely nobody else is not locked out of
// moving client money — but the exception belongs to the ONE MEMBER THE COUNT FOUND, never to
// whoever happens to reach the check while a lone holder exists. Both halves are required together:
// a clerk who can submit but not authorize must not be able to borrow a lone manager's exception and
// release money alone. The triggers in the per-firm migration hold exactly this pair; this is the
// read in front of them, and the one place the pair is written in TypeScript so the two callers
// cannot drift apart.
export async function resolveLoneTrustManagerException(
  database: SqlDatabase,
  actor: UserId,
): Promise<{
  readonly available: boolean;
  readonly managers: readonly { user_id: string; display_name: string }[];
}> {
  const managers = await readActiveTrustManagers(database);
  const actorIsTheCountedManager = managers.some((manager) => manager.user_id === actor);
  return { available: managers.length === 1 && actorIsTheCountedManager, managers };
}

export interface TrustAuthorityHolderSummary {
  readonly userId: UserId;
  readonly displayName: string;
}

// Why a member cannot release this money alone: they do not hold the authority the firm requires, or
// the amount takes a second person and they are not the firm's lone holder. Two different remedies
// (grant the capability, or ask a colleague), so they stay two different answers.
export type TrustAuthorizationRouteReason = "authority-required" | "second-person-required";

export interface TrustAuthorizationDisposition {
  // `solo` means this member may release this amount by themselves, on the stated basis. `route`
  // means somebody else has to settle it, and `eligibleApprovers` says who.
  readonly mode: "solo" | "route";
  // The footing a solo decision will record on its face. Null on a route, because a basis is a
  // property of a decision and nobody has decided yet.
  readonly authorizationBasis: TrustDisbursementAuthorizationBasis | null;
  readonly routeReason: TrustAuthorizationRouteReason | null;
  readonly policy: TrustAuthorizationPolicySnapshot;
  readonly requiresSecondPerson: boolean;
  // Who may settle this if the actor cannot — never the actor themselves on a route, so a caller
  // rendering the list can never invite somebody to do the thing that was just refused.
  readonly eligibleApprovers: readonly TrustAuthorityHolderSummary[];
}

export interface TrustAuthorizationDispositionInput {
  // The policy that GOVERNS this decision: the current version for something being proposed now, the
  // version stamped on a request for something already pending. Stated by the caller rather than
  // read here, because which policy applies is the whole question the stamp exists to answer.
  readonly policy: TrustAuthorizationPolicySnapshot;
  readonly amountMinor: number;
  readonly actor: UserId;
}

function toHolderSummaries(
  rows: readonly { user_id: string; display_name: string }[],
  excluding: UserId | null,
): readonly TrustAuthorityHolderSummary[] {
  return rows
    .filter((row) => row.user_id !== excluding)
    .map((row) => ({ userId: row.user_id as UserId, displayName: row.display_name }));
}

// THE SHARED DISPOSITION READ — asked BEFORE anything is composed: may this member release this
// amount alone, on what footing, and if not, who can? Both money-out paths ask it, so the choice
// between acting and queueing is made from the same answer the guards enforce, rather than by
// composing something and catching the refusal. A refusal is the right face for a mistake and the
// wrong face for an ordinary outcome — a member without the authority raising a payment for somebody
// else to release has done nothing wrong.
//
// This adds no new rule. It calls the same predicate the guards call, over the same policy row, and
// the same two membership reads the triggers count; it exists so a caller can see the answer in
// advance, never so a caller can substitute its own. Every path out of it is a refusal or a
// route — nothing here can widen what the composers and the triggers will accept, and an
// unrecognized policy kind propagates the predicate's throw rather than resolving to "no second
// person required".
export async function resolveTrustAuthorizationDisposition(
  database: SqlDatabase,
  input: TrustAuthorizationDispositionInput,
): Promise<TrustAuthorizationDisposition> {
  const { policy, amountMinor, actor } = input;
  const requiresSecondPerson = trustAuthorizationRequiresSecondPerson(policy, amountMinor);

  // The authority gate is asked FIRST and on its own, because it binds whoever lets money go at any
  // amount: a member the firm has not given the authority to can never be the one who releases,
  // whether or not a second person is also required. Asking it first is also what makes the
  // membership test unconditional — the answer is "is the ACTOR in the holder set", never "does the
  // firm have one".
  const authorityHolders = await readActiveTrustAuthorityHolders(database);
  if (policy.requireAuthorizedApprover) {
    const actorHoldsAuthority = authorityHolders.some((holder) => holder.user_id === actor);
    if (!actorHoldsAuthority) {
      return {
        mode: "route",
        authorizationBasis: null,
        routeReason: "authority-required",
        policy,
        requiresSecondPerson,
        eligibleApprovers: toHolderSummaries(authorityHolders, actor),
      };
    }
  }

  if (!requiresSecondPerson) {
    return {
      mode: "solo",
      authorizationBasis: "policy_exempt",
      routeReason: null,
      policy,
      requiresSecondPerson,
      eligibleApprovers: [],
    };
  }

  // A second person is required at this amount. The only way one member still acts is the
  // lone-holder exception, and it is the actor's only if the actor IS the firm's one holder.
  const exception = await resolveLoneTrustManagerException(database, actor);
  if (exception.available) {
    return {
      mode: "solo",
      authorizationBasis: "sole_trust_manager",
      routeReason: null,
      policy,
      requiresSecondPerson,
      eligibleApprovers: [],
    };
  }

  // Who the second person may be: when the firm requires authority, exactly its holders (peer
  // approval — two holders satisfy it, and there is no regress); otherwise the members who can reach
  // the decision at all, which is the set the lone-holder rule counts.
  const deciders = policy.requireAuthorizedApprover ? authorityHolders : exception.managers;
  return {
    mode: "route",
    authorizationBasis: null,
    routeReason: "second-person-required",
    policy,
    requiresSecondPerson,
    eligibleApprovers: toHolderSummaries(deciders, actor),
  };
}

export interface TrustAuthorizationPolicyChangeInput {
  readonly policy: TrustAuthorizationPolicyKind;
  readonly thresholdAmountMinor?: number | null;
  readonly requireAuthorizedApprover: boolean;
  readonly setBy: UserId;
}

export interface ComposedTrustAuthorizationPolicyChange {
  readonly policyId: TrustAuthorizationPolicyId;
  readonly version: number;
  readonly setAt: string;
  readonly previous: TrustAuthorizationPolicySnapshot;
  readonly effect: EffectWrite;
}

// Changing the firm's money-movement posture. The new version and its audit row ride one batch; the
// version-dense trigger settles a concurrent change by aborting the loser, whose caller re-reads and
// decides again against the posture that actually won. Metadata carries the from/to shape — ids and
// configuration values only, nothing privileged.
export async function composeTrustAuthorizationPolicyChange(
  database: SqlDatabase,
  input: TrustAuthorizationPolicyChangeInput,
  options: TrustServiceOptions,
): Promise<ComposedTrustAuthorizationPolicyChange> {
  const thresholdAmountMinor = input.thresholdAmountMinor ?? null;
  if (input.policy === "threshold") {
    if (
      thresholdAmountMinor === null ||
      !Number.isInteger(thresholdAmountMinor) ||
      thresholdAmountMinor < 0
    ) {
      throw new TrustValidationError(
        "trust-authorization-policy-threshold-required",
        "a threshold policy names the amount in minor units above which a second person is required, zero or more",
      );
    }
  } else if (thresholdAmountMinor !== null) {
    throw new TrustValidationError(
      "trust-authorization-policy-threshold-forbidden",
      `an ${input.policy} policy carries no threshold amount; state the posture you mean`,
    );
  }

  const current = await readCurrentTrustAuthorizationPolicy(database);
  if (
    current.policy === input.policy &&
    current.thresholdAmountMinor === thresholdAmountMinor &&
    current.requireAuthorizedApprover === input.requireAuthorizedApprover
  ) {
    throw new TrustValidationError(
      "trust-authorization-policy-unchanged",
      "this is already the firm's authorization posture; a version records a change, not a re-statement",
    );
  }

  const policyId = newIdentifier("trustAuthorizationPolicy", options.randomSource);
  const version = current.version + 1;
  const setAt = options.clock.now();
  return {
    policyId,
    version,
    setAt,
    previous: current,
    effect: {
      statements: [
        insertTrustAuthorizationPolicyStatement(database, {
          id: policyId,
          version,
          policy: input.policy,
          thresholdAmountMinor,
          requireAuthorizedApprover: input.requireAuthorizedApprover,
          setBy: input.setBy,
          setAt,
        }),
        domainAuditStatement(database, {
          event: AUTHORIZATION_POLICY_CHANGED_AUDIT_EVENT,
          subjectId: policyId,
          actorUserId: input.setBy,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {
            fromVersion: current.version,
            fromPolicy: current.policy,
            fromThresholdAmountMinor: current.thresholdAmountMinor,
            fromRequireAuthorizedApprover: current.requireAuthorizedApprover,
            toVersion: version,
            toPolicy: input.policy,
            toThresholdAmountMinor: thresholdAmountMinor,
            toRequireAuthorizedApprover: input.requireAuthorizedApprover,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}
