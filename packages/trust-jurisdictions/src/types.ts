import type { TrustJurisdictionRequirement } from "@magna-carta/trust/jurisdiction";

// The contract for compiled trust-accounting reference data: what one jurisdiction's rules say, with
// enough provenance attached that "why does this requirement apply to me" is a question the product
// can answer rather than a claim it makes.
//
// This is REFERENCE DATA, identical for every firm. A rule correction is a package release, never a
// migration against every tenant. Nothing here holds per-firm state, reads a database, or knows what
// a firm owes — it answers what a jurisdiction requires, and the trust domain decides what to do
// about it.

// How much is known about a field, and it is the discriminant that makes a wrong claim
// unrepresentable rather than merely unlikely.
//
//   HIGH / MEDIUM   a value was found and is carried
//   NOT_ADDRESSED   the rule was READ and says nothing — a finding, and the reason for the name:
//                   "N/A" reads as NOT APPLICABLE, which is the one thing this never means
//   GAP             nobody has researched this. Opposite of NOT_ADDRESSED, and never resolvable
export type FieldConfidence = "HIGH" | "MEDIUM" | "NOT_ADDRESSED" | "GAP";

// Why a MEDIUM is medium. `judgmentStandard` is terminal: the rule assigns the decision to the
// lawyer, so no amount of further research promotes it, and an engine that resolved it to a value
// would be making a call the rule expressly withholds from anyone but the lawyer.
export type MediumKind =
  | "secondarySource" // a handbook or ethics opinion carries it; the black-letter rule is quiet
  | "judgmentStandard" // the rule delegates the call to the lawyer — permanent
  | "noEnumeration"; // the rule says "complete records" and declines to list — permanent

// How close to the law the source is. `primaryOfficial` means the publisher a court would cite.
export type SourceTier = "primaryOfficial" | "corroborated" | "secondary";

export interface Provenance {
  readonly citation: string;
  // Verbatim, always, when a value is asserted. A value whose source cannot be quoted is a value
  // nobody can check, and the reviewing attorney is checking exactly this.
  readonly quote?: string;
  readonly sourceUrl?: string;
  readonly sourceTier: SourceTier;
  // The rule's own last-amendment date, taken from its published source note. Court rules move by
  // court order on no fixed schedule, so re-verification is a comparison of this date against the
  // rule's current source note rather than a re-reading of the text.
  readonly ruleEffectiveDate?: string;
  // Fetched-on date for the retrieval this value was transcribed from.
  readonly retrievedOn: string;
}

// `value` exists only on HIGH and MEDIUM. A silence has no value to read and the compiler enforces
// it — a field cannot simultaneously report that the rule said nothing and carry what it said.
export type TypedField<T> =
  | {
      readonly confidence: "HIGH";
      readonly value: T;
      readonly note: string;
      readonly provenance: Provenance;
    }
  | {
      readonly confidence: "MEDIUM";
      readonly value: T;
      readonly mediumKind: MediumKind;
      readonly note: string;
      readonly provenance: Provenance;
    }
  | {
      readonly confidence: "NOT_ADDRESSED";
      readonly note: string;
      readonly provenance: Provenance;
    }
  | { readonly confidence: "GAP"; readonly note: string };

// A rule carried for its citation alone. Segregation, disputed funds, and the firm-funds bank-charge
// carve-out live here rather than in `typed` because nothing branches on them: the first two are
// enforced for every firm regardless of jurisdiction, and the third is a permission the platform
// does not yet act on. Typing them would be actively harmful — a typed `segregation: false` invites
// a caller to branch on it.
export interface CitedRule {
  readonly confidence: FieldConfidence;
  readonly summary: string;
  readonly provenance: Provenance;
}

// The machine-readable values, one per requirement the trust domain can compute on. A field earns a
// type only when code must compute on it — adding one later is additive and safe, while removing a
// wrong one after firms rely on it is not.

export interface RecordsRetention {
  readonly years: number;
  // Retention rules disagree about WHEN the clock starts, and two rules of one jurisdiction can
  // disagree with each other. Naming the trigger is what keeps a shared number from implying a
  // shared deadline.
  readonly clocks: readonly {
    readonly trigger: string;
    readonly citation: string;
  }[];
}

export interface ReconciliationRequirement {
  readonly required: boolean;
  // Absent when nothing is required. A jurisdiction that mandates no reconciliation has no cadence,
  // and an invented one would be a claim about the law.
  readonly cadence?: "monthly" | "quarterly";
  readonly threeWay?: boolean;
}

export type ProhibitedDisbursementMethod =
  | "cashWithdrawal"
  | "automatedTellerMachine"
  | "debitCard"
  | "checkPayableToCash"
  | "overdraftProtection"
  | "electronicTransferWithoutWrittenAuthorization";

export interface InterestOnLawyerTrustAccount {
  readonly mandatory: boolean;
  readonly recipient: string;
  readonly remitCadence?: "monthly" | "quarterly";
  readonly minimumRateDescription?: string;
}

// One name, two kinds of rule. A jurisdiction that states a figure is computable; one that assigns
// the call to the lawyer is not, and the difference is a type rather than a comment.
export type InterestThreshold =
  | { readonly kind: "netInterestTest"; readonly amountMinor: number; readonly currency: string }
  | { readonly kind: "lawyerJudgment"; readonly standard: string };

export interface OverdraftNotification {
  readonly required: boolean;
  readonly notifyBody?: string;
  // Whose duty it is to report. In most jurisdictions it is the bank's, which changes what the
  // platform can usefully do about it — a firm cannot be prompted to file a report it does not owe.
  readonly reportedBy?: "financialInstitution" | "lawyer";
  readonly reportWithinBankingDays?: number;
}

export interface UnclaimedFunds {
  readonly destination: string;
  // Whether the jurisdiction COMPELS remittance or merely permits it. A permissive rule encoded as
  // a duty would put a deadline on a firm that has none.
  readonly remittance: "required" | "permitted";
  readonly waitingPeriod: string; // ISO 8601 duration
  // What the waiting period is measured FROM. Receipt of the property and a dormancy determination
  // are different events, and a period measured from the wrong one expires on the wrong day.
  readonly waitingPeriodRunsFrom: string;
  readonly diligenceRequired: boolean;
}

export interface AnnualCompliance {
  readonly required: boolean;
  readonly cadence: "annual" | "biennial";
  readonly instrument?: string;
}

export interface AdvanceFeeTreatment {
  // Whether fees paid before the work is done are client money until earned.
  readonly advanceFeesHeldInTrust: boolean;
  readonly withdrawableWhen: string;
}

export interface ProcessorFees {
  readonly mayChargeClientPrincipal: boolean;
}

// Every typed requirement, keyed by exactly the names the trust domain's jurisdiction seam declares.
// The two lists are held in step by a test rather than by a shared constant, because the seam is the
// contract and this package is one implementation of it.
export interface TypedRequirements {
  readonly recordsRetention: TypedField<RecordsRetention>;
  readonly reconciliation: TypedField<ReconciliationRequirement>;
  readonly interestOnLawyerTrustAccount: TypedField<InterestOnLawyerTrustAccount>;
  readonly interestThreshold: TypedField<InterestThreshold>;
  readonly prohibitedDisbursementMethods: TypedField<readonly ProhibitedDisbursementMethod[]>;
  readonly overdraftNotification: TypedField<OverdraftNotification>;
  readonly unclaimedFunds: TypedField<UnclaimedFunds>;
  readonly annualCompliance: TypedField<AnnualCompliance>;
  readonly advanceFeeTreatment: TypedField<AdvanceFeeTreatment>;
  readonly processorFees: TypedField<ProcessorFees>;
}

// Who signed off on this jurisdiction's rules, and when. Nullable, and on the profile rather than on
// each field: review is an act performed over a whole jurisdiction by one person on one day, and
// nothing in the profile resolves while it is null.
export interface AttorneyReview {
  readonly reviewedBy: string;
  readonly barNumber: string;
  readonly reviewedOn: string; // ISO 8601 date
  // What the reviewer read. A review of a profile is a review of the values AND the sources they
  // were taken from, and recording the corpus revision is what makes a later amendment detectable
  // as invalidating the review rather than silently inheriting it.
  readonly profileRevision: string;
}

export interface JurisdictionProfile {
  readonly jurisdictionCode: string;
  readonly name: string;
  // Bumped whenever any value or citation in this profile changes. An attorney review naming an
  // earlier revision no longer covers the profile, and the review gate says so.
  readonly revision: string;
  readonly attorneyReview: AttorneyReview | null;
  readonly typed: TypedRequirements;
  // Carried for citation; never branched on.
  readonly cited: {
    readonly segregation: CitedRule;
    readonly disputedFunds: CitedRule;
    readonly firmFundsForBankCharges: CitedRule;
    readonly requiredRecords: CitedRule;
  };
}

// Which way a wrong silence fails, which is what decides whether a silence may resolve at all.
//
//   rigor        a wrong silence OVER-complies. Safe.
//   restriction  a wrong silence UNDER-restricts — it hands a lawyer a method the rule forbids.
//                So a restriction resolves to off ONLY on a silence that was recorded as read.
//   data         a wrong silence ASSERTS A WRONG FACT about the world. Never resolvable from
//                silence: "the rule does not say who receives the interest" is not "nobody does".
export type RequirementBucket = "rigor" | "restriction" | "data";

export const REQUIREMENT_BUCKETS: Readonly<
  Record<TrustJurisdictionRequirement, RequirementBucket>
> = {
  recordsRetention: "rigor",
  reconciliation: "rigor",
  interestOnLawyerTrustAccount: "data",
  interestThreshold: "data",
  prohibitedDisbursementMethods: "restriction",
  overdraftNotification: "data",
  unclaimedFunds: "data",
  annualCompliance: "data",
  advanceFeeTreatment: "data",
  processorFees: "data",
};
