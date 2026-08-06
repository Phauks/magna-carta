import { describe, expect, it } from "vitest";
import { CustodyValidationError } from "../src/validation.ts";
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
    // And the NEGATION is in the prose, not only in the boolean. A surface rendering one field of
    // this entry must not be able to show Nevada offering lifetime court deposit, which is exactly
    // the never-enacted uniform-act reading the entry exists to refute.
    expect(deposit?.question).toMatch(/\?$/);
    expect(deposit?.answer).toMatch(/^No\./);
    expect(deposit?.answer).toContain("no procedure");
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

  // Null means "this duty has no computable interval" and nothing else. A trigger date the function
  // cannot read is a REFUSAL, because the two are fixed differently — one by asking the court, one by
  // correcting what somebody typed — and reading "no deadline applies" out of a typo is the worst
  // version of the conflation this module's own doctrine forbids.
  it("refuses a date it cannot read, rather than reading it as no deadline", () => {
    const delivery = resolveCustodyWillDuties("US-NV").duties[0];
    expect(() => custodyWillDeliveryDueDate(delivery!, "sometime last spring")).toThrow(
      CustodyValidationError,
    );
  });

  // The pattern alone accepts 2026-02-31, and Date.UTC rolls it over to 2 March — so an impossible
  // date would otherwise produce a confident statutory deadline computed from a day that never was.
  it("refuses a date that is not on the calendar", () => {
    const delivery = resolveCustodyWillDuties("US-NV").duties[0];
    expect(() => custodyWillDeliveryDueDate(delivery!, "2026-02-31")).toThrow(
      /must be a date on the calendar/,
    );
  });

  // A longer string names the 5th only in UTC; its own offset makes it a different day. Taking the
  // leading date would answer about a day the caller did not name.
  it("refuses an instant rather than reading its leading date", () => {
    const delivery = resolveCustodyWillDuties("US-NV").duties[0];
    expect(() => custodyWillDeliveryDueDate(delivery!, "2026-08-05T23:00:00-07:00")).toThrow(
      /civil date of the form YYYY-MM-DD/,
    );
  });
});

// A typo in a jurisdiction key is a typo, not a finding about the law. Answering `us-nv` with "no
// verified duties are encoded" would tell a firm that nobody has researched Nevada — false, and
// exactly the confusion the catalog's two distinct refusals exist to keep apart.
describe("a jurisdiction key is matched on identity, not on shape", () => {
  it("resolves a key whatever its case and separator", () => {
    expect(resolveCustodyWillDuties("us-nv").jurisdictionKey).toBe("US-NV");
    expect(resolveCustodyWillDuties("  US_NV  ").jurisdictionKey).toBe("US-NV");
    expect(resolveCustodyWillDuties("us-nv-08").jurisdictionKey).toBe("US-NV-08");
  });

  // The ancestor probe walks all the way up: a key two levels below the encoded state still gets
  // told which wider jurisdiction has a verified answer.
  it("names the nearest encoded ancestor however far below it the key sits", () => {
    expect(() => resolveCustodyWillDuties("US-NV-08-CLARK")).toThrow(/US-NV-08 is encoded/);
    expect(() => resolveCustodyWillDuties("US-NV-08-CLARK-NORTH")).toThrow(/US-NV-08 is encoded/);
    expect(() => resolveCustodyWillDuties("US-CA-01-SOMEWHERE")).toThrow(
      /there is no baseline to fall back to/,
    );
  });
});
