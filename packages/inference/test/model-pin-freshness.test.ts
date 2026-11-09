import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "../src/catalog.ts";
import {
  RETIREMENT_WARNING_DAYS,
  VERIFICATION_DUE_AFTER_DAYS,
  VERIFICATION_EXPIRED_AFTER_DAYS,
  expiredModelPins,
  formatModelPinReport,
  modelPinFindings,
  modelPinFindingsFor,
} from "../src/model-pin-freshness.ts";

// Every case runs against a fixture at a fixed date. The pass takes `today` as a parameter precisely so
// its behaviour can be pinned here rather than only observed on the day the calendar happens to trip it.

function entry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    slot: "reasoning",
    modelId: "provider/example-model",
    displayName: "Example Model",
    snapshotId: "example-model-20260101",
    snapshotForm: "provider-dated",
    referenceId: "example-model",
    zdrEligible: true,
    noTrainingEligible: true,
    verifiedOn: "2026-08-01",
    availabilityVerifiedOn: "2026-08-01",
    ...overrides,
  };
}

const reasons = (findings: readonly { reason: string }[]) => findings.map((f) => f.reason);

// The fixture's recorded dates are all 2026-08-01, so every "today" in these cases is expressed as an
// offset from it rather than as a second literal that has to be kept in step by hand.
const daysAfter = (days: number) =>
  civilDateOf(new Date(Date.parse("2026-08-01T00:00:00Z") + days * 86_400_000));

describe("a published retirement date", () => {
  it("is silent while the date is far away", () => {
    const findings = modelPinFindingsFor(
      entry({ retirementNotBefore: "2027-08-01" }),
      "2026-08-01",
    );
    expect(reasons(findings)).toEqual([]);
  });

  it("comes due once the date is inside the warning window", () => {
    const findings = modelPinFindingsFor(
      entry({ retirementNotBefore: "2026-09-01" }),
      "2026-08-01",
    );
    expect(reasons(findings)).toEqual(["approaching-published-retirement"]);
    expect(findings[0]?.severity).toBe("due");
    expect(findings[0]?.detail).toContain("2026-09-01");
  });

  it("is due exactly on the warning boundary and silent one day outside it", () => {
    // The boundary is asserted from both sides: an off-by-one here is the difference between a warning
    // that arrives with time to act and one that arrives after the model is gone.
    const onBoundary = new Date(
      Date.parse("2026-08-01T00:00:00Z") + RETIREMENT_WARNING_DAYS * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    const justOutside = new Date(
      Date.parse("2026-08-01T00:00:00Z") + (RETIREMENT_WARNING_DAYS + 1) * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    expect(
      reasons(modelPinFindingsFor(entry({ retirementNotBefore: onBoundary }), "2026-08-01")),
    ).toEqual(["approaching-published-retirement"]);
    expect(
      reasons(modelPinFindingsFor(entry({ retirementNotBefore: justOutside }), "2026-08-01")),
    ).toEqual([]);
  });

  it("EXPIRES — and so fails the gate — once the date has passed", () => {
    const findings = modelPinFindingsFor(
      entry({ retirementNotBefore: "2026-07-31" }),
      "2026-08-01",
    );
    expect(reasons(findings)).toEqual(["past-published-retirement"]);
    expect(findings[0]?.severity).toBe("expired");
  });

  it("says nothing at all when the provider publishes no retirement date", () => {
    expect(reasons(modelPinFindingsFor(entry(), "2026-08-01"))).toEqual([]);
  });
});

describe("a published successor", () => {
  it("comes due but never expires — moving to it is a decision, not a fix", () => {
    const findings = modelPinFindingsFor(
      entry({ supersededBy: "provider/next-model" }),
      "2026-08-01",
    );
    expect(reasons(findings)).toEqual(["successor-published"]);
    expect(findings[0]?.severity).toBe("due");
    expect(findings[0]?.detail).toContain("provider/next-model");
    expect(
      expiredModelPins("2026-08-01", [entry({ supersededBy: "provider/next-model" })]),
    ).toEqual([]);
  });
});

describe("a fact nobody has re-read", () => {
  it("is silent inside the re-read interval", () => {
    expect(
      reasons(modelPinFindingsFor(entry(), daysAfter(VERIFICATION_DUE_AFTER_DAYS - 1))),
    ).toEqual([]);
  });

  it("comes due for the confidentiality facts and the lifecycle facts separately", () => {
    const findings = modelPinFindingsFor(entry(), daysAfter(VERIFICATION_DUE_AFTER_DAYS));
    expect(reasons(findings)).toEqual(["confidentiality-facts-unread", "lifecycle-facts-unread"]);
    expect(findings.every((f) => f.severity === "due")).toBe(true);
  });

  it("tracks the two dates independently — a lifecycle re-read does not launder a confidentiality claim", () => {
    // The whole reason the catalog carries two dates. Reading the provider's deprecation page tells you
    // the model still exists; it tells you nothing about whether it still runs under zero data
    // retention, and one date would let the cheaper check silently refresh the claim that matters.
    const findings = modelPinFindingsFor(
      entry({ verifiedOn: "2026-08-01", availabilityVerifiedOn: daysAfter(300) }),
      daysAfter(VERIFICATION_DUE_AFTER_DAYS),
    );
    expect(reasons(findings)).toEqual(["confidentiality-facts-unread"]);
  });

  it("EXPIRES past the hard interval", () => {
    const findings = modelPinFindingsFor(entry(), daysAfter(VERIFICATION_EXPIRED_AFTER_DAYS));
    expect(findings.every((f) => f.severity === "expired")).toBe(true);
  });
});

describe("the pass itself", () => {
  it("refuses a date it cannot parse rather than silently reporting nothing", () => {
    // A malformed date that quietly produced zero findings would read exactly like a clean catalog.
    expect(() => modelPinFindingsFor(entry(), "14-08-2026")).toThrow(/ISO/);
  });

  it("is zone-independent — the same catalog and date answer the same anywhere", () => {
    const fixture = [entry({ retirementNotBefore: "2026-08-02" })];
    expect(modelPinFindings("2026-08-01", fixture)).toEqual(
      modelPinFindings("2026-08-01", fixture),
    );
    expect(modelPinFindings("2026-08-01", fixture)[0]?.detail).toContain("1 days away");
  });

  it("reports nothing due for a fresh catalog", () => {
    expect(formatModelPinReport("2026-08-01", [entry()])).toContain("nothing due");
  });

  it("names every finding in the report", () => {
    const report = formatModelPinReport("2026-08-01", [
      entry({ supersededBy: "provider/next-model", retirementNotBefore: "2026-07-01" }),
    ]);
    expect(report).toContain("[expired]");
    expect(report).toContain("[due]");
    expect(report).toContain("provider/example-model");
  });
});
