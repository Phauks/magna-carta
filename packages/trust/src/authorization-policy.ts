import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { TrustAuthorizationPolicyId, UserId } from "@magna-carta/identifiers/types";
import type { TrustServiceOptions } from "./account-tree.ts";
import {
  insertTrustAuthorizationPolicyStatement,
  selectActiveTrustAuthorityHoldersStatement,
  selectCurrentTrustAuthorizationPolicyStatement,
  selectTrustAuthorizationPolicyHistoryStatement,
  selectTrustAuthorizationPolicyStatement,
} from "./statements.ts";
import { TrustValidationError } from "./trust-validation.ts";
import type { TrustAuthorizationPolicyKind, TrustAuthorizationPolicySnapshot } from "./types.ts";

// THE FIRM'S DISBURSEMENT-AUTHORIZATION POLICY — whether money leaving a client ledger takes a
// second person, and whether whoever lets it go must hold the authority capability. One policy, two
// consumers: the disbursement approval flow (disbursement-authorization.ts) and the earned-fee
// transfer (transfer.ts, and through it billing's application path) both answer "does this amount
// take a second person" through `trustAuthorizationRequiresSecondPerson` below, and the triggers in
// the per-firm migration hold the same predicate at the database — a route is one code path among
// several that reach those tables.
//
// THE SHIPPED DEFAULT IS THE STRICT ONE. A firm with no policy row has the posture the platform
// shipped with before the policy existed: always two-person, no authority requirement. Nothing
// relaxes on migrate; relaxing is an explicit, versioned, audited act.
//
// A POSTURE CHANGE GOVERNS NEW AUTHORIZATIONS ONLY. Requests stamp the version current when they
// were submitted and are decided under that stamp — the triggers read the stamp, never the latest
// row — so a pending request keeps the rules it was created under, in both directions: relaxing the
// policy does not unlock a request submitted under the strict one, and tightening it does not strand
// a request the old policy exempted.

export const AUTHORIZATION_POLICY_CHANGED_AUDIT_EVENT = "trust.authorization_policy_changed";

// Version 0, no row, no id: what every firm has until it deliberately writes a version.
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
// has never written one. `.all()` + `results[0]`, never `.first()` — the node-sqlite test adapter
// has no `.first()`.
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
