import type { TrustJurisdictionRequirement } from "@magna-carta/trust/jurisdiction";
import { TrustValidationError } from "@magna-carta/trust/trust-validation";
import { findJurisdictionProfile } from "./registry.ts";
import {
  type FieldConfidence,
  type JurisdictionProfile,
  type MediumKind,
  type Provenance,
  REQUIREMENT_BUCKETS,
  type RequirementBucket,
  type TypedField,
} from "./types.ts";

// Turning an encoded jurisdiction into an answer, and — far more often — into a refusal that names
// which of four different things is missing. The four are not interchangeable and each is fixed by a
// different person doing a different thing:
//
//   jurisdiction-not-recorded   the trust account's office has no state on it. Fixed by recording
//                               it. (Raised upstream, in @magna-carta/trust/jurisdiction.)
//   jurisdiction-not-encoded    nobody has researched that jurisdiction. Fixed by researching one.
//   jurisdiction-not-verified   the rules ARE encoded, and no attorney has reviewed them. Fixed by
//                               an attorney reading them. This is the gate, and it is the reason a
//                               half-finished corpus cannot leak into a compliance answer.
//   requirement-not-encoded     the jurisdiction is reviewed and this one field was never
//                               researched. Fixed by researching that field.
//
// Collapsing any two of them produces the same failure: a firm is told something about its
// obligations that nobody has stood behind.

export interface ResolvedRequirement<T> {
  readonly requirement: TrustJurisdictionRequirement;
  readonly jurisdictionCode: string;
  readonly value: T;
  // `false` means RENDER THIS, NEVER GATE ON IT. A rule that assigns the decision to the lawyer
  // gets surfaced with its standard and its citation, and the engine does not make the call.
  readonly binding: boolean;
  readonly citation: string;
  readonly confidence: FieldConfidence;
  readonly mediumKind?: MediumKind;
  readonly bucket: RequirementBucket;
  // Where the answer came from. `recordedSilence` is not a weaker `jurisdiction` — it is the finding
  // that the rule was read and says nothing, which for a restriction is the only safe way to reach
  // "off".
  readonly source: "jurisdiction" | "recordedSilence";
  readonly provenance: Provenance;
  readonly note: string;
}

// What a silence MEANS, per requirement, and only where it has a determinate meaning.
//
// A restriction's silence means the method is not banned — that is the whole point of insisting the
// silence be recorded rather than assumed. A rigor silence about reconciliation means the
// jurisdiction requires none, which is a real and useful answer. Every DATA requirement is absent
// from this map on purpose: "the rule does not say who receives the interest" is not "nobody does",
// and a silence there would assert a fact about the world that nobody checked.
//
// Frozen, deeply: these singletons are handed out as resolved values, and a resolved value is
// reference data shared by every caller. Without the freeze, one caller pushing a method into the
// resolved empty array would quietly ban it for every later resolve — a mutation of the law itself,
// from the caller least entitled to make it. Freezing fails that write loudly at the mutation site.
const SILENCE_MEANS: Partial<Record<TrustJurisdictionRequirement, unknown>> = Object.freeze({
  prohibitedDisbursementMethods: Object.freeze([]),
  reconciliation: Object.freeze({ required: false }),
});

export interface JurisdictionDescription {
  readonly jurisdictionCode: string;
  readonly name: string;
  readonly revision: string;
  readonly encoded: boolean;
  // The whole point of the gate: an unreviewed jurisdiction is SHOWN, with its values and its
  // citations, and marked not-verified. Hiding it would tell a firm the platform knows nothing about
  // Nevada, which is false and would stop anybody from reviewing it.
  readonly verified: boolean;
  readonly attorneyReview: JurisdictionProfile["attorneyReview"];
  readonly profile: JurisdictionProfile | null;
}

// The read that never throws. A surface uses this to say what the platform has and what it will not
// yet answer; `resolve` is for the moment something must actually be decided.
export function describeJurisdiction(jurisdictionCode: string): JurisdictionDescription {
  const profile = findJurisdictionProfile(jurisdictionCode);
  if (profile === null) {
    return {
      jurisdictionCode,
      name: jurisdictionCode,
      revision: "",
      encoded: false,
      verified: false,
      attorneyReview: null,
      profile: null,
    };
  }
  return {
    jurisdictionCode: profile.jurisdictionCode,
    name: profile.name,
    revision: profile.revision,
    encoded: true,
    verified: isReviewCurrent(profile),
    attorneyReview: profile.attorneyReview,
    profile,
  };
}

// The revision string a review binds to, DERIVED from the profile's content rather than hand-set
// beside it. The authored `revision` date names when the profile was last deliberately amended; the
// fingerprint proves nothing in it has moved since. An amendment that forgets to bump the date still
// changes the fingerprint, so the recorded attestation stops matching and the gate closes — the
// hand-set string alone could silently inherit a review of text the reviewer never saw.
//
// The fingerprint covers everything a reviewing attorney attests to — every value, citation, quote,
// note, and provenance field — and deliberately excludes `attorneyReview` itself, so recording the
// review does not invalidate the review being recorded.
export function deriveProfileRevision(profile: JurisdictionProfile): string {
  const attested: Omit<JurisdictionProfile, "attorneyReview"> = {
    jurisdictionCode: profile.jurisdictionCode,
    name: profile.name,
    revision: profile.revision,
    typed: profile.typed,
    cited: profile.cited,
  };
  return `${profile.revision}#${fingerprintOfContent(attested)}`;
}

// A stable serialization (object keys sorted at every depth, so key order in a source file is not
// content) hashed with the 64-bit Fowler-Noll-Vo function. Not cryptographic and does not need to
// be: the adversary is an honest editor forgetting a bump, not an attacker forging a collision.
function fingerprintOfContent(content: unknown): string {
  const serialized = JSON.stringify(sortObjectKeysDeeply(content));
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < serialized.length; index++) {
    hash ^= BigInt(serialized.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

function sortObjectKeysDeeply(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sortObjectKeysDeeply(entry));
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .slice()
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return Object.fromEntries(entries.map(([key, entry]) => [key, sortObjectKeysDeeply(entry)]));
  }
  return value;
}

// A review covers the profile it was performed against. When a rule is amended and the profile is
// re-authored, its derived revision moves — by the authored date when the editor remembered the
// bump, by the content fingerprint regardless — and the old review no longer covers it, so the gate
// closes again rather than silently inheriting an attestation about superseded text. That is the
// difference between a review gate and a one-time checkbox.
export function isReviewCurrent(profile: JurisdictionProfile): boolean {
  const review = profile.attorneyReview;
  return review !== null && review.profileRevision === deriveProfileRevision(profile);
}

export function resolveJurisdictionRequirement<T>(
  jurisdictionCode: string,
  requirement: TrustJurisdictionRequirement,
): ResolvedRequirement<T> {
  const profile = findJurisdictionProfile(jurisdictionCode);
  if (profile === null) {
    throw new TrustValidationError(
      "jurisdiction-not-encoded",
      `no rules are encoded for ${jurisdictionCode}: ${requirement} cannot be resolved, and there is no baseline to fall back to`,
    );
  }
  return resolveFromProfile<T>(profile, requirement);
}

// Split out from the registry lookup so the gate and the bucket asymmetry can be exercised against a
// profile directly. Every encoded jurisdiction ships unreviewed, so a test that could only reach this
// through the registry could never reach the code past the gate at all.
export function resolveFromProfile<T>(
  profile: JurisdictionProfile,
  requirement: TrustJurisdictionRequirement,
): ResolvedRequirement<T> {
  // THE GATE. Encoded is not reviewed. Everything below this line is a compliance answer a firm will
  // act on, and none of it is available until a named attorney has read the values against the rule
  // text on a stated date, against this revision of the profile.
  if (!isReviewCurrent(profile)) {
    const review = profile.attorneyReview;
    const because =
      review === null
        ? "no attorney has reviewed it"
        : `the recorded review covers revision ${review.profileRevision} and the profile is now revision ${deriveProfileRevision(profile)}`;
    throw new TrustValidationError(
      "jurisdiction-not-verified",
      `the rules encoded for ${profile.name} are not verified: ${because}, so ${requirement} does not resolve`,
    );
  }

  const field = profile.typed[requirement] as TypedField<T>;
  const bucket = REQUIREMENT_BUCKETS[requirement];

  if (field.confidence === "GAP") {
    throw new TrustValidationError(
      "jurisdiction-requirement-not-encoded",
      `${requirement} has not been researched for ${profile.name}: ${field.note}`,
    );
  }

  if (field.confidence === "NOT_ADDRESSED") {
    if (!(requirement in SILENCE_MEANS)) {
      throw new TrustValidationError(
        "jurisdiction-requirement-not-encoded",
        `${profile.name} is silent on ${requirement}, and a silence about this states nothing that can be resolved into a value`,
      );
    }
    return {
      requirement,
      jurisdictionCode: profile.jurisdictionCode,
      value: SILENCE_MEANS[requirement] as T,
      binding: true,
      citation: field.provenance.citation,
      confidence: field.confidence,
      bucket,
      source: "recordedSilence",
      provenance: field.provenance,
      note: field.note,
    };
  }

  // A judgment standard is the rule handing the decision to the lawyer. Surfacing it is right;
  // gating on it would be the platform making a call the rule expressly reserves.
  const mediumKind = field.confidence === "MEDIUM" ? field.mediumKind : undefined;
  return {
    requirement,
    jurisdictionCode: profile.jurisdictionCode,
    value: field.value,
    binding: mediumKind !== "judgmentStandard",
    citation: field.provenance.citation,
    confidence: field.confidence,
    ...(mediumKind === undefined ? {} : { mediumKind }),
    bucket,
    source: "jurisdiction",
    provenance: field.provenance,
    note: field.note,
  };
}
