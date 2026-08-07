import { TRUST_JURISDICTION_REQUIREMENTS } from "@magna-carta/trust/jurisdiction";
import { describe, expect, it } from "vitest";
import { NEVADA_PROFILE } from "../src/data/nevada.ts";
import { deriveProfileRevision, resolveFromProfile } from "../src/resolve.ts";
import {
  type AttorneyReview,
  type JurisdictionProfile,
  type ProhibitedDisbursementMethod,
  type ReconciliationRequirement,
  type RecordsRetention,
  REQUIREMENT_BUCKETS,
} from "../src/types.ts";

// Nevada as if an attorney had reviewed it. Every assertion below is about what the encoded values
// SAY; whether they may be acted on is the gate's business and is proven in review-gate.test.ts.
const REVIEW: AttorneyReview = {
  reviewedBy: "Reviewing Attorney",
  barNumber: "00000",
  reviewedOn: "2026-08-07",
  profileRevision: deriveProfileRevision(NEVADA_PROFILE),
};
const REVIEWED_NEVADA: JurisdictionProfile = { ...NEVADA_PROFILE, attorneyReview: REVIEW };

function refusalCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  throw new Error("expected a refusal");
}

describe("the profile covers exactly the requirements the trust domain declares", () => {
  // The seam is the contract; this package is one implementation of it. A requirement added there
  // and missed here would otherwise resolve to undefined rather than refuse.
  it("has a typed field for every declared requirement and no others", () => {
    expect(new Set(Object.keys(NEVADA_PROFILE.typed))).toEqual(
      new Set(TRUST_JURISDICTION_REQUIREMENTS),
    );
  });
});

describe("every asserted value can be checked against its source", () => {
  it("carries a citation, a source tier, and a retrieval date on every field", () => {
    for (const field of Object.values(NEVADA_PROFILE.typed)) {
      if (field.confidence === "GAP") {
        expect(field.note.length).toBeGreaterThan(0);
        continue;
      }
      expect(field.provenance.citation.length).toBeGreaterThan(0);
      expect(field.provenance.retrievedOn).toBe("2026-08-07");
    }
  });

  // A value the reviewing attorney cannot check against the rule is a value they cannot review.
  it("carries a verbatim quote on every field that asserts a value", () => {
    for (const [requirement, field] of Object.entries(NEVADA_PROFILE.typed)) {
      if (field.confidence !== "HIGH" && field.confidence !== "MEDIUM") continue;
      expect(field.provenance.quote, `${requirement} asserts a value without a quote`).toBeTruthy();
    }
    for (const rule of Object.values(NEVADA_PROFILE.cited)) {
      expect(rule.provenance.quote).toBeTruthy();
    }
  });

  it("carries a mediumKind on every MEDIUM, so a permanent standard is not mistaken for a backlog item", () => {
    for (const field of Object.values(NEVADA_PROFILE.typed)) {
      if (field.confidence === "MEDIUM") expect(field.mediumKind).toBeTruthy();
    }
  });
});

describe("the three corrections to what was previously recorded about Nevada", () => {
  // Five, not seven. Seven is the pre-2021 text and is what the state bar's own handbook still says.
  it("records retention as five years, from two different events", () => {
    const resolved = resolveFromProfile<RecordsRetention>(REVIEWED_NEVADA, "recordsRetention");
    expect(resolved.value.years).toBe(5);
    expect(resolved.value.clocks.map((clock) => clock.citation)).toEqual([
      "NRPC 1.15(a)",
      "SCR 78(1)(b)",
    ]);
    expect(resolved.binding).toBe(true);
  });

  // Nevada mandates no reconciliation at any cadence. A recorded silence, and the resolved value
  // carries no cadence at all — an invented one would be a claim about the law.
  it("resolves reconciliation to not-required, from a recorded silence and with no cadence", () => {
    const resolved = resolveFromProfile<ReconciliationRequirement>(
      REVIEWED_NEVADA,
      "reconciliation",
    );
    expect(resolved.value.required).toBe(false);
    expect(resolved.value.cadence).toBeUndefined();
    expect(resolved.value.threeWay).toBeUndefined();
    expect(resolved.source).toBe("recordedSilence");
  });

  // The governing account-mechanics rule is SCR 78. SCR 78.5 was repealed in 2019, and every value
  // taken from it must cite the live rule.
  it("cites SCR 78 and never the repealed SCR 78.5", () => {
    const serialized = JSON.stringify(NEVADA_PROFILE);
    expect(serialized).toContain("Nev. Sup. Ct. R. 78(1)(b)");
    expect(serialized).not.toMatch(/R\.?\s?78\.5/);
  });
});

describe("the restriction bucket resolves off only on a recorded silence", () => {
  it("resolves no prohibited disbursement methods for Nevada", () => {
    const resolved = resolveFromProfile<readonly string[]>(
      REVIEWED_NEVADA,
      "prohibitedDisbursementMethods",
    );
    expect(resolved.value).toEqual([]);
    expect(resolved.source).toBe("recordedSilence");
    expect(resolved.bucket).toBe("restriction");
    // State bar guidance against automated-teller access is carried as a note, so a firm can still
    // see it and opt in — it is simply not a Nevada rule.
    expect(resolved.note).toContain("ATM access");
  });

  // The silence-resolved values are shared reference data, one instance handed to every caller. A
  // caller pushing a method into the resolved empty array would otherwise ban it for every later
  // resolve, platform-wide; the freeze fails that write loudly at the mutation site instead.
  it("hands out frozen silence values a caller cannot mutate for everyone else", () => {
    const methods = resolveFromProfile<readonly ProhibitedDisbursementMethod[]>(
      REVIEWED_NEVADA,
      "prohibitedDisbursementMethods",
    );
    expect(() => {
      (methods.value as ProhibitedDisbursementMethod[]).push("cashWithdrawal");
    }).toThrowError(TypeError);

    const reconciliation = resolveFromProfile<ReconciliationRequirement>(
      REVIEWED_NEVADA,
      "reconciliation",
    );
    expect(() => {
      (reconciliation.value as { required: boolean }).required = true;
    }).toThrowError(TypeError);

    // And the shared instances really are unchanged for the next caller.
    expect(
      resolveFromProfile<readonly ProhibitedDisbursementMethod[]>(
        REVIEWED_NEVADA,
        "prohibitedDisbursementMethods",
      ).value,
    ).toEqual([]);
    expect(
      resolveFromProfile<ReconciliationRequirement>(REVIEWED_NEVADA, "reconciliation").value
        .required,
    ).toBe(false);
  });
});

describe("a rule that assigns the decision to the lawyer is rendered, never gated on", () => {
  it("resolves the interest threshold as advisory", () => {
    const resolved = resolveFromProfile(REVIEWED_NEVADA, "interestThreshold");
    expect(resolved.binding).toBe(false);
    expect(resolved.mediumKind).toBe("judgmentStandard");
    expect(resolved.citation).toContain("221");
  });
});

describe("a data requirement never resolves from silence or from absence", () => {
  // Nobody researched processor fees for Nevada. That is not a silence and it does not resolve.
  it("refuses processorFees as an unresearched field", () => {
    expect(refusalCode(() => resolveFromProfile(REVIEWED_NEVADA, "processorFees"))).toBe(
      "jurisdiction-requirement-not-encoded",
    );
  });

  // A silence in the data bucket asserts nothing that can become a fact: "the rule does not say who
  // receives the interest" is not "nobody does". Asserted across EVERY data requirement rather than
  // one of them, because the way this rule breaks is somebody adding a convenient default for a
  // single field, and a test naming one field would not see it.
  it("refuses every data requirement whose rule was read and says nothing", () => {
    const dataRequirements = TRUST_JURISDICTION_REQUIREMENTS.filter(
      (requirement) => REQUIREMENT_BUCKETS[requirement] === "data",
    );
    expect(dataRequirements.length).toBeGreaterThan(0);

    for (const requirement of dataRequirements) {
      // The review is derived from the SILENCED content, so the gate is open and the refusal under
      // test is the field's own — not the review gate closing over the content change.
      const silencedContent: JurisdictionProfile = {
        ...NEVADA_PROFILE,
        typed: {
          ...NEVADA_PROFILE.typed,
          [requirement]: {
            confidence: "NOT_ADDRESSED",
            note: "the rule is silent",
            provenance: {
              citation: "none",
              sourceTier: "primaryOfficial",
              retrievedOn: "2026-08-07",
            },
          },
        },
      };
      const silenced: JurisdictionProfile = {
        ...silencedContent,
        attorneyReview: { ...REVIEW, profileRevision: deriveProfileRevision(silencedContent) },
      };
      expect(
        refusalCode(() => resolveFromProfile(silenced, requirement)),
        `${requirement} resolved from a silence`,
      ).toBe("jurisdiction-requirement-not-encoded");
    }
  });
});

describe("the values that describe money leaving or sitting in trust", () => {
  it("puts advance fees in trust, withdrawable only as earned", () => {
    const resolved = resolveFromProfile<{ advanceFeesHeldInTrust: boolean }>(
      REVIEWED_NEVADA,
      "advanceFeeTreatment",
    );
    expect(resolved.value.advanceFeesHeldInTrust).toBe(true);
    expect(resolved.citation).toContain("1.15(c)");
  });

  // Nevada's unclaimed-funds remittance is PERMISSIVE and its clock runs from receipt, not from a
  // dormancy determination. Both are places a reshaped value would state a duty or a date Nevada
  // does not.
  it("records unclaimed funds as permitted, not required, on a clock that runs from receipt", () => {
    const resolved = resolveFromProfile<{
      remittance: string;
      waitingPeriod: string;
      waitingPeriodRunsFrom: string;
      destination: string;
    }>(REVIEWED_NEVADA, "unclaimedFunds");
    expect(resolved.value.remittance).toBe("permitted");
    expect(resolved.value.waitingPeriod).toBe("P5Y");
    expect(resolved.value.waitingPeriodRunsFrom).toBe("receipt of the property");
    expect(resolved.value.destination).toBe("Clients Security Fund");
  });

  it("records the overdraft report as the bank's duty, within five banking days when honored", () => {
    const resolved = resolveFromProfile<{
      reportedBy: string;
      reportWithinBankingDays: number;
    }>(REVIEWED_NEVADA, "overdraftNotification");
    expect(resolved.value.reportedBy).toBe("financialInstitution");
    expect(resolved.value.reportWithinBankingDays).toBe(5);
  });

  // The recipient is the one encoded value whose authority is not a rule: SCR 216 creates a
  // designation power and names nobody. The note has to say so, because that is what the reviewing
  // attorney is being asked to confirm.
  it("flags that the IOLTA recipient does not come from the rule text", () => {
    const field = NEVADA_PROFILE.typed.interestOnLawyerTrustAccount;
    if (field.confidence !== "HIGH") throw new Error("expected an asserted value");
    expect(field.provenance.sourceTier).toBe("corroborated");
    expect(field.note).toContain("NOT IN THE RULE");
  });
});

describe("the bank-charge carve-out is cited and is not wired", () => {
  // Nevada permits it. The platform does not act on it, and the permission is carried as a citation
  // precisely so the two facts sit in the same place. It is deliberately NOT among the typed
  // requirements — nothing may branch on it.
  it("carries NRPC 1.15(b) verbatim as a cited rule, not as a resolvable value", () => {
    const carveOut = NEVADA_PROFILE.cited.firmFundsForBankCharges;
    expect(carveOut.provenance.citation).toContain("1.15(b)");
    expect(carveOut.provenance.quote).toBe(
      "A lawyer may deposit the lawyer's own funds in a client trust account for the sole purpose of paying bank service charges on that account, but only in an amount necessary for that purpose.",
    );
    expect(Object.keys(NEVADA_PROFILE.typed)).not.toContain("firmFundsForBankCharges");
  });

  // The account exemption is what makes the permission nearly inapplicable to a pooled account, and
  // it is the reason wiring the carve-out needs an account-type discriminator the platform lacks.
  it("records the interest-bearing account exemption alongside it", () => {
    expect(NEVADA_PROFILE.cited.firmFundsForBankCharges.summary).toContain("217(3)");
  });
});
