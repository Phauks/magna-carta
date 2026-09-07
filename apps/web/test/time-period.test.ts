/*
 * The period ledger's two decisions.
 *
 * WHOSE TIME is a permission question with a real refusal behind it, so the wrong answer is not a
 * cosmetic one: offering a colleague's name to somebody who cannot read it produces a control that
 * fails every time it is used, and dropping the firm from a supervisor's list takes away the reason
 * they opened the screen.
 *
 * WHAT THE STRIP SAYS has to hold two things apart that a careless total collapses — billable and
 * non-billable are both real work, and a void is neither.
 */
import { describe, expect, it } from "vitest";
import type { FirmMemberSummary } from "../src/lib/members/members-api.ts";
import type { TimeEntrySummary } from "../src/lib/matters/time-api.ts";
import { periodTotals } from "../src/lib/time/time-figures.ts";
import {
  choiceByIdentifier,
  periodFigureReading,
  timekeeperChoices,
} from "../src/lib/time/time-period.ts";

const ME = "user_me";
const COLLEAGUE = "user_colleague";

const roster: readonly FirmMemberSummary[] = [
  { userId: ME, displayName: "Wren Adeyemi", status: "active" } as FirmMemberSummary,
  { userId: COLLEAGUE, displayName: "Alba Ferreira", status: "active" } as FirmMemberSummary,
  { userId: "user_gone", displayName: "Departed Colleague", status: "deactivated" },
] as FirmMemberSummary[];

describe("whose time a reader may ask for", () => {
  it("offers a member without the capability themselves and nobody else", () => {
    const choices = timekeeperChoices(roster, ME, false);
    expect(choices).toHaveLength(1);
    expect(choices[0]?.timekeeperUserId).toBe(ME);
    expect(choices[0]?.label).toBe("Wren Adeyemi");
  });

  it("leads a capability holder with the whole firm, then themselves, then colleagues", () => {
    const choices = timekeeperChoices(roster, ME, true);
    expect(choices.map((choice) => choice.label)).toEqual([
      "Everyone",
      "Wren Adeyemi",
      "Alba Ferreira",
    ]);
    expect(choices[0]?.timekeeperUserId).toBeNull();
  });

  it("does not offer a departed colleague", () => {
    const choices = timekeeperChoices(roster, ME, true);
    expect(choices.some((choice) => choice.timekeeperUserId === "user_gone")).toBe(false);
  });

  it("names the reader before their own name has been read", () => {
    const choices = timekeeperChoices([], ME, false);
    expect(choices[0]?.label).toBe("My time");
  });

  it("offers nothing at all while the session is unknown and the reader cannot see the firm", () => {
    expect(timekeeperChoices(roster, null, false)).toEqual([]);
  });

  it("finds a choice the address named, and nothing for one it does not hold", () => {
    const choices = timekeeperChoices(roster, ME, true);
    expect(choiceByIdentifier(choices, COLLEAGUE)?.label).toBe("Alba Ferreira");
    expect(choiceByIdentifier(choices, "user_stranger")).toBeUndefined();
  });
});

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
    expect(withVoid[0]?.caption).toContain("1 voided entry counts toward nothing");

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
