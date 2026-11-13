/*
 * What the firm's Time screen's strip says.
 *
 * It has to hold two things apart that a careless total collapses — billable and non-billable are
 * both real work, and a void is neither. Whose time is read is the Timekeeper column's filter now,
 * pinned in money-listing-scope.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { TimeEntrySummary } from "../src/lib/matters/time-api.ts";
import { periodTotals } from "../src/lib/time/time-figures.ts";
import { periodFigureReading } from "../src/lib/time/time-period.ts";

const ME = "user_me";

function entry(over: Partial<TimeEntrySummary>): TimeEntrySummary {
  return {
    id: "timeEntry_1",
    matterId: "matter_1",
    timekeeperUserId: ME,
    workDate: "2026-09-01",
    durationMinutes: 60,
    rawDurationMinutes: 60,
    narrative: "Worked",
    billable: true,
    amountMinor: 30_000,
    currency: "USD",
    status: "draft",
    ...over,
  };
}

describe("what a period says about itself", () => {
  const entries = [
    entry({ id: "a", durationMinutes: 90, amountMinor: 45_000 }),
    entry({ id: "b", durationMinutes: 30, amountMinor: 15_000, status: "billed" }),
    entry({ id: "c", durationMinutes: 60, billable: false, amountMinor: null }),
    entry({ id: "d", durationMinutes: 120, amountMinor: 60_000, status: "void" }),
  ];

  it("counts every live hour, billable and not, and leaves the void out of all of them", () => {
    const totals = periodTotals(entries);
    expect(totals.liveCount).toBe(3);
    expect(totals.voidCount).toBe(1);
    expect(totals.recordedMinutes).toBe(180);
    expect(totals.billableMinutes).toBe(120);
    expect(totals.nonBillableMinutes).toBe(60);
  });

  it("splits the money at the invoice rather than at the lifecycle", () => {
    const totals = periodTotals(entries);
    // The draft is unbilled; the billed one is billed; the non-billable entry charges nothing and
    // the void counts toward neither.
    expect(totals.unbilledAmountMinor).toBe(45_000);
    expect(totals.billedAmountMinor).toBe(15_000);
  });

  it("says on the recorded figure that a void is being left out, and stays quiet when none is", () => {
    const money = (amountMinor: number): string => `$${(amountMinor / 100).toFixed(2)}`;
    const withVoid = periodFigureReading(periodTotals(entries), money);
    expect(withVoid[0]?.caption).toContain("1 voided entry is not counted");

    const clean = periodFigureReading(periodTotals(entries.slice(0, 3)), money);
    expect(clean[0]?.caption).not.toContain("voided");
  });

  it("reads hours before money, and renders the money through the surface's own currency", () => {
    const reading = periodFigureReading(periodTotals(entries), (minor) => `USD ${String(minor)}`);
    expect(reading.map((figure) => figure.label)).toEqual([
      "recorded",
      "billable",
      "non-billable",
      "unbilled",
      "billed",
    ]);
    expect(reading[3]?.value).toBe("USD 45000");
  });
});
