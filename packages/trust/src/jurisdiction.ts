import { TrustValidationError } from "./trust-validation.ts";
import type { TrustAccountSnapshot } from "./types.ts";

// The jurisdiction seam. The compiled rules corpus, the per-jurisdiction typed profiles, and the
// resolver's bucket asymmetry are their own stream and their own package — reference data is a
// package release rather than a migration, so it can be built in parallel with everything here.
// What this module owns is the CONTRACT that stream must satisfy, and the behaviour in its absence.
//
// That behaviour is to REFUSE. Not to warn, not to fall back to a baseline, not to resolve to the
// most common answer. A jurisdiction fact asserts something about the world — who receives the
// interest, where unclaimed funds escheat, which body takes an overdraft report, whether an advanced
// flat fee even belongs in trust — and a wrong silence states a wrong fact to a lawyer who will act
// on it. "We have not encoded this for your jurisdiction" is a sentence a firm can check. A
// confidently wrong answer is one they will not.

export const TRUST_JURISDICTION_REQUIREMENTS = [
  "recordsRetention",
  "reconciliation",
  "interestOnLawyerTrustAccount",
  "interestThreshold",
  "prohibitedDisbursementMethods",
  "overdraftNotification",
  "unclaimedFunds",
  "annualCompliance",
  "advanceFeeTreatment",
  "processorFees",
] as const;
export type TrustJurisdictionRequirement = (typeof TRUST_JURISDICTION_REQUIREMENTS)[number];

// A resolved requirement always carries its provenance, and `binding: false` means "render this,
// never gate on it" — the shape a rule takes when it delegates the call to the lawyer's judgment
// rather than stating a value. An engine that quietly made that call would be practising law.
export interface ResolvedTrustRequirement<T> {
  readonly requirement: TrustJurisdictionRequirement;
  readonly value: T;
  readonly binding: boolean;
  readonly citation: string;
}

export interface TrustJurisdictionPort {
  resolve<T>(
    jurisdiction: string,
    requirement: TrustJurisdictionRequirement,
  ): ResolvedTrustRequirement<T>;
}

// The default port, and the one every caller gets until a reviewed corpus is bound. It refuses every
// field for every jurisdiction, so a surface that has not been taught to handle a refusal fails
// loudly in development rather than silently shipping a fabricated requirement to a firm.
export const refusingTrustJurisdictions: TrustJurisdictionPort = {
  resolve<T>(
    jurisdiction: string,
    requirement: TrustJurisdictionRequirement,
  ): ResolvedTrustRequirement<T> {
    throw new TrustValidationError(
      "jurisdiction-not-encoded",
      `no reviewed rules are encoded for ${jurisdiction}: ${requirement} cannot be resolved, and there is no baseline to fall back to`,
    );
  },
};

// A trust account whose office recorded no jurisdiction has nothing to resolve AGAINST, which is a
// different refusal from "we have not encoded that jurisdiction" and is surfaced as such: the first
// is fixed by recording the office's state, the second by researching and reviewing a jurisdiction.
// Conflating the two is exactly the mistake that tells a firm its obligations are optional.
export function requireTrustJurisdiction(account: TrustAccountSnapshot): string {
  if (account.jurisdiction === null || account.jurisdiction.trim().length === 0) {
    throw new TrustValidationError(
      "jurisdiction-not-recorded",
      `trust account ${account.id} has no jurisdiction recorded — it is derived from the office that holds the account`,
    );
  }
  return account.jurisdiction;
}

export function resolveTrustRequirement<T>(
  port: TrustJurisdictionPort,
  account: TrustAccountSnapshot,
  requirement: TrustJurisdictionRequirement,
): ResolvedTrustRequirement<T> {
  return port.resolve<T>(requireTrustJurisdiction(account), requirement);
}
