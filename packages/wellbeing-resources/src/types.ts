// The shipped wellbeing-resources model. Ships the product-relevant subset of the research corpus
// (docs/research/wellbeing-resources/): the research-only provenance fields (confidence, sourceUrl,
// sourceTier) are dropped by the generator; verifiedOn is kept as the freshness signal a product cares
// about. Populated data lives in the generated data.generated.ts; this file is the contract.

// Who runs a resource. Bars run some directly; others are affiliated nonprofits, the courts, an
// outsourced EAP/clinical vendor, or a national program (the safety net).
export type OperatorType = "stateBar" | "nonprofit" | "court" | "vendor" | "national";

// Geographic reach. A jurisdiction can carry statewide programs plus a metro-scoped one; the national
// safety net is "national".
export type ResourceScope = "statewide" | "metro" | "national";

// When a phone line is reachable. "aroundTheClock" is set only where a source literally states 24/7 —
// never inferred; an unstated line is "unspecified".
export type Availability = "aroundTheClock" | "businessHours" | "unspecified";

// What a resource offers.
export type ServiceTag =
  | "counseling"
  | "substanceUse"
  | "mentalHealth"
  | "peerSupport"
  | "crisisLine"
  | "teletherapy"
  | "financialAid"
  | "familySupport"
  | "monitoring";

export interface Phone {
  readonly number: string; // display form, e.g. "800-343-8527"
  readonly label: string; // "Confidential helpline", "Office", "Intake"
  readonly availability: Availability;
  readonly hoursNote?: string; // free text when the hours are nuanced
}

// One mental-health / emotional-support resource available to lawyers in a jurisdiction.
export interface WellbeingResource {
  readonly name: string;
  readonly operator: string;
  readonly operatorType: OperatorType;
  readonly scope: ResourceScope;
  readonly url?: string; // landing page — may sit off the bar's own domain
  readonly email?: string;
  readonly phones: readonly Phone[];
  readonly services: readonly ServiceTag[];
  readonly confidential: string; // short qualifier, e.g. "Confidential by statute"
  readonly cost: string; // "Free" | "Some services free; fees may apply"
  readonly description: string;
  readonly verifiedOn: string; // ISO date the url/phone was last confirmed
}

// A US jurisdiction (state, DC, or territory), keyed by 2-digit FIPS and 2-letter code. A jurisdiction
// with no dedicated program has empty `resources` and `nationalFallbackOnly: true` — it resolves to the
// national safety net by design, which is an answer, not a gap.
export interface JurisdictionEntry {
  readonly fips: string; // 2 digits
  readonly code: string; // 2 uppercase letters
  readonly name: string;
  readonly resources: readonly WellbeingResource[];
  readonly nationalFallbackOnly: boolean;
}
