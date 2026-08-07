import {
  refusingTrustJurisdictions,
  TRUST_JURISDICTION_REQUIREMENTS,
} from "@magna-carta/trust/jurisdiction";
import { describe, expect, it } from "vitest";
import { NEVADA_PROFILE } from "../src/data/nevada.ts";
import { encodedTrustJurisdictions } from "../src/port.ts";
import { encodedJurisdictionCodes, findJurisdictionProfile } from "../src/registry.ts";
import {
  deriveProfileRevision,
  describeJurisdiction,
  isReviewCurrent,
  resolveJurisdictionRequirement,
} from "../src/resolve.ts";
import type { AttorneyReview, JurisdictionProfile } from "../src/types.ts";

function refusalCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  throw new Error("expected a refusal");
}

describe("Nevada ships encoded and NOT verified", () => {
  it("records no attorney review", () => {
    expect(NEVADA_PROFILE.attorneyReview).toBeNull();
    expect(isReviewCurrent(NEVADA_PROFILE)).toBe(false);
  });

  // The gate. Every requirement refuses, and it refuses with a code that says WHY — the rules exist
  // and nobody has stood behind them — rather than with the code that means nobody researched them.
  it("refuses every requirement with jurisdiction-not-verified, not not-encoded", () => {
    for (const requirement of TRUST_JURISDICTION_REQUIREMENTS) {
      expect(refusalCode(() => resolveJurisdictionRequirement("US-NV", requirement))).toBe(
        "jurisdiction-not-verified",
      );
    }
  });

  // Refusing to resolve is not refusing to show. A firm that can see what the platform has, marked
  // unverified, can get it reviewed; a firm shown nothing concludes the platform knows nothing.
  it("still describes itself, with its values and citations, marked not verified", () => {
    const described = describeJurisdiction("US-NV");
    expect(described.encoded).toBe(true);
    expect(described.verified).toBe(false);
    expect(described.profile?.typed.recordsRetention.confidence).toBe("HIGH");
  });
});

describe("the review gate binds to the revision it was performed against", () => {
  const review: AttorneyReview = {
    reviewedBy: "Reviewing Attorney",
    barNumber: "00000",
    reviewedOn: "2026-08-07",
    profileRevision: deriveProfileRevision(NEVADA_PROFILE),
  };
  const reviewed: JurisdictionProfile = { ...NEVADA_PROFILE, attorneyReview: review };

  it("opens when the review names the current derived revision", () => {
    expect(isReviewCurrent(reviewed)).toBe(true);
  });

  // Amending a rule bumps the revision, and a review of the superseded text stops covering the
  // profile. Without this a single review would carry forward across every future amendment.
  it("closes again when the profile is amended past the reviewed revision", () => {
    expect(isReviewCurrent({ ...reviewed, revision: "2027-01-01" })).toBe(false);
  });

  // THE CASE THE DERIVATION EXISTS FOR. An editor amends a value and forgets to bump the authored
  // revision date. The hand-set string is unchanged, so a string-equality gate would inherit the
  // attestation; the content fingerprint moves, so the derived revision no longer matches and the
  // gate closes anyway.
  it("closes when a value is amended and the revision date is NOT bumped", () => {
    const amended: JurisdictionProfile = {
      ...reviewed,
      typed: {
        ...reviewed.typed,
        recordsRetention: {
          confidence: "HIGH",
          value: { years: 7, clocks: [{ trigger: "amended", citation: "NRPC 1.15(a)" }] },
          note: "an amendment nobody stamped",
          provenance: {
            citation: "NRPC 1.15(a)",
            quote: "seven years",
            sourceTier: "primaryOfficial",
            retrievedOn: "2027-01-01",
          },
        },
      },
    };
    expect(amended.revision).toBe(reviewed.revision);
    expect(isReviewCurrent(amended)).toBe(false);
  });

  // A review recorded against the bare authored date is a review recorded wrong, and it opens
  // nothing — the gate accepts only the derived form, which is what forces the recorder through
  // deriveProfileRevision and gives the fingerprint its bite.
  it("does not open for a review naming the authored date alone", () => {
    const dateOnly: JurisdictionProfile = {
      ...NEVADA_PROFILE,
      attorneyReview: { ...review, profileRevision: NEVADA_PROFILE.revision },
    };
    expect(isReviewCurrent(dateOnly)).toBe(false);
  });

  // Recording the review must not invalidate the review being recorded: the fingerprint covers the
  // attested content and excludes the attestation itself.
  it("derives the same revision before and after the review is recorded", () => {
    expect(deriveProfileRevision(reviewed)).toBe(deriveProfileRevision(NEVADA_PROFILE));
  });
});

describe("an unencoded jurisdiction is a different refusal, and there is no baseline", () => {
  it("encodes exactly one jurisdiction", () => {
    expect(encodedJurisdictionCodes()).toEqual(["US-NV"]);
  });

  it("refuses every other jurisdiction with jurisdiction-not-encoded", () => {
    for (const code of ["US-CA", "US-TX", "US-SC", "US-NY", "GU", ""]) {
      expect(findJurisdictionProfile(code)).toBeNull();
      expect(refusalCode(() => resolveJurisdictionRequirement(code, "recordsRetention"))).toBe(
        "jurisdiction-not-encoded",
      );
    }
  });

  it("describes an unencoded jurisdiction without throwing and without inventing a profile", () => {
    const described = describeJurisdiction("US-CA");
    expect(described.encoded).toBe(false);
    expect(described.verified).toBe(false);
    expect(described.profile).toBeNull();
  });
});

describe("binding the port never loosens what the refusing default did", () => {
  // The whole point of the corpus stream is that binding it is safe. For every requirement and every
  // jurisdiction, the encoded port must refuse wherever the default refused — today that is
  // everywhere, because Nevada is unreviewed.
  it("refuses everything the refusing default refused", () => {
    for (const code of ["US-NV", "US-CA"]) {
      for (const requirement of TRUST_JURISDICTION_REQUIREMENTS) {
        expect(() => refusingTrustJurisdictions.resolve(code, requirement)).toThrowError();
        expect(() => encodedTrustJurisdictions.resolve(code, requirement)).toThrowError();
      }
    }
  });
});
