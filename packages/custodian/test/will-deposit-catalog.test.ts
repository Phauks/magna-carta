import { describe, expect, it } from "vitest";
import {
  custodyWillDeliveryDueDate,
  ENCODED_CUSTODY_WILL_JURISDICTION_KEYS,
  requireCustodyJurisdiction,
  resolveCustodyWillDuties,
} from "../src/will-deposit-catalog.ts";

describe("the will-deposit catalog refuses rather than guesses", () => {
  // The two refusals are DIFFERENT, and keeping them different is the whole contract. "Nobody told
  // us which law" is fixed by recording a fact about the firm; "nobody has verified that law" is
  // fixed by research. A firm handed one when it has the other looks in the wrong place, and a firm
  // handed silence reads it as freedom.
  it("distinguishes a jurisdiction nobody recorded from a jurisdiction nobody encoded", () => {
    expect(() => resolveCustodyWillDuties(null)).toThrow(/no jurisdiction was recorded/);
    let notRecorded: unknown;
    try {
      resolveCustodyWillDuties("   ");
    } catch (caught) {
      notRecorded = caught;
    }
    expect(notRecorded).toMatchObject({ code: "custody-jurisdiction-not-recorded" });

    let notEncoded: unknown;
    try {
      resolveCustodyWillDuties("US-CA");
    } catch (caught) {
      notEncoded = caught;
    }
    expect(notEncoded).toMatchObject({ code: "custody-jurisdiction-not-encoded" });
  });

  it("never falls back to a baseline, and never answers with an empty list", () => {
    for (const key of ["US-TX", "US-NY", "GB-EW", "AU-NSW"]) {
      expect(() => resolveCustodyWillDuties(key)).toThrow(/no verified will-deposit duties/);
    }
    expect(ENCODED_CUSTODY_WILL_JURISDICTION_KEYS).not.toContain("US-CA");
  });

  // A local rule nobody checked is not the same as a local rule that does not exist. Nevada has
  // eleven judicial districts and two were verified, so the other nine refuse on their own terms —
  // resolving them to the state entry alone would answer "the county requires nothing".
  it("refuses an unencoded sub-jurisdiction even where its parent is encoded, and says so", () => {
    let caught: unknown;
    try {
      resolveCustodyWillDuties("US-NV-01");
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "custody-jurisdiction-not-encoded" });
    expect((caught as Error).message).toContain("US-NV is encoded");
  });

  it("names the recorded jurisdiction back, trimmed", () => {
    expect(requireCustodyJurisdiction(" US-NV ")).toBe("US-NV");
    expect(() => requireCustodyJurisdiction(undefined)).toThrow();
  });
});

describe("Nevada, encoded from the statute itself", () => {
  it("surfaces the 30-day delivery duty with the verbatim statutory text and its citation", () => {
    const nevada = resolveCustodyWillDuties("US-NV");
    const delivery = nevada.duties.find((duty) => duty.key === "delivery-of-will-after-death");
    expect(delivery).toBeDefined();
    expect(delivery?.citation).toBe("NRS 136.050(1), (3), (4), (5)");
    expect(delivery?.deadlineBasis).toBe("daysAfterTrigger");
    expect(delivery?.deadlineDays).toBe(30);
    // Quoted exactly, because a firm can check a quotation against the published statute and cannot
    // check a paraphrase against anything.
    expect(delivery?.statutoryText).toBe(
      "Any person having possession of a will shall, within 30 days after knowledge of the death of the person who executed the will, deliver it to the clerk of the district court which has jurisdiction of the case or to the personal representative named in the will.",
    );
    // The statute writes "or": both targets discharge the duty, and choosing between them is the
    // firm's call.
    expect(delivery?.deliveryTargets).toHaveLength(2);
    // The clock starts at KNOWLEDGE of the death, not the death.
    expect(delivery?.trigger).toContain("knowledge of the death");
    expect(delivery?.consequenceOfNeglect).toContain(
      "liable to every person interested in the will",
    );
    // Delivering to the clerk publishes the will. That is a real client-facing consequence of a
    // choice the statute leaves open, so it is carried rather than dropped.
    expect(delivery?.sideEffects.join(" ")).toContain("open to inspection");
  });

  it("carries the personal representative's own duty and the court-ordered production separately", () => {
    const nevada = resolveCustodyWillDuties("US-NV");
    const presentation = nevada.duties.find(
      (duty) => duty.key === "presentation-by-named-personal-representative",
    );
    expect(presentation?.citation).toBe("NRS 136.050(2), (3)");
    expect(presentation?.deliveryTargets).toEqual(["the clerk of the court"]);

    // A court-set date is not an interval, and flattening it into one would invent a deadline the
    // court supplies.
    const production = nevada.duties.find((duty) => duty.key === "production-under-court-order");
    expect(production?.deadlineBasis).toBe("setByCourtOrder");
    expect(production?.deadlineDays).toBeNull();
    expect(production?.citation).toBe("NRS 136.060(1), (2)");
  });

  // Encoded because uniform-act deposit language that Nevada never enacted circulates as though it
  // were Nevada law. Without the explicit negative, "no entry" and "no such procedure" look alike.
  it("records the absence of a lifetime court deposit as a verified negative", () => {
    const nevada = resolveCustodyWillDuties("US-NV");
    const deposit = nevada.capabilities.find(
      (capability) => capability.key === "lifetime-deposit-with-a-court",
    );
    expect(deposit?.available).toBe(false);
    expect(deposit?.basis).toContain("No Nevada statute or court rule provides for it");
  });

  // The lodging duty is a local court rule, so it is keyed BELOW the state. Encoding it statewide
  // would assert something about nine districts nobody checked.
  it("keys county lodging below the state and returns the statute above it", () => {
    const clark = resolveCustodyWillDuties("US-NV-08");
    expect(clark.duties.map((duty) => duty.key)).toEqual([
      "lodging-the-original-with-a-probate-petition",
      "delivery-of-will-after-death",
      "presentation-by-named-personal-representative",
      "production-under-court-order",
    ]);
    expect(clark.duties[0]?.citation).toBe("EDCR 4.40(a)–(b)");
    expect(clark.duties[0]?.deadlineBasis).toBe("concurrentWithFiling");

    const washoe = resolveCustodyWillDuties("US-NV-02");
    expect(washoe.duties[0]?.citation).toBe("Second Judicial District Court Rule 57.7(1)–(2)");
    expect(washoe.duties[0]?.deliveryTargets).toEqual(["the filing office"]);

    // Asking the state returns the state's own duties, and names the sub-jurisdictions that carry
    // more, so a state-level answer is not mistaken for the whole picture.
    const nevada = resolveCustodyWillDuties("US-NV");
    expect(nevada.duties.map((duty) => duty.key)).not.toContain(
      "lodging-the-original-with-a-probate-petition",
    );
    expect([...nevada.encodedSubJurisdictionKeys].sort()).toEqual(["US-NV-02", "US-NV-08"]);
  });

  // The electronic-will qualified custodian scheme and the professional-conduct rules are real and
  // verified, and are deliberately NOT here: the first is an opt-in role a firm decides to take on,
  // the second is not a will-delivery deadline and would read as one in a deadline catalog.
  it("encodes no qualified-custodian role and no records-keeping duty", () => {
    const serialized = JSON.stringify(resolveCustodyWillDuties("US-NV"));
    expect(serialized).not.toContain("qualified custodian");
    expect(serialized).not.toContain("NRS 133.3");
    expect(serialized).not.toContain("NRPC");
  });
});

describe("a due date comes only from a date a person recorded", () => {
  it("counts the statutory days forward from the supplied trigger date", () => {
    const delivery = resolveCustodyWillDuties("US-NV").duties.find(
      (duty) => duty.key === "delivery-of-will-after-death",
    );
    expect(delivery).toBeDefined();
    expect(custodyWillDeliveryDueDate(delivery!, "2026-03-01")).toBe("2026-03-31");
    // Across a month boundary and a leap day, so the arithmetic is calendar-correct rather than
    // thirty-days-is-a-month.
    expect(custodyWillDeliveryDueDate(delivery!, "2028-02-15")).toBe("2028-03-16");
  });

  it("computes nothing for a duty whose deadline is not an interval", () => {
    const nevada = resolveCustodyWillDuties("US-NV");
    const production = nevada.duties.find((duty) => duty.key === "production-under-court-order");
    expect(custodyWillDeliveryDueDate(production!, "2026-03-01")).toBeNull();
    const lodging = resolveCustodyWillDuties("US-NV-08").duties[0];
    expect(custodyWillDeliveryDueDate(lodging!, "2026-03-01")).toBeNull();
  });

  it("computes nothing from a date it cannot read, rather than guessing one", () => {
    const delivery = resolveCustodyWillDuties("US-NV").duties[0];
    expect(custodyWillDeliveryDueDate(delivery!, "sometime last spring")).toBeNull();
  });
});
