/*
 * The Time ledger's model, pinned.
 *
 * Each case below is a place where a quiet mistake would look right on screen and be wrong in a way
 * somebody would act on: a duration shown in one literacy when the firm reads two, a non-billable
 * entry reading as zero money, a void counted into a total, a figure whose scope silently changed
 * under a filter, or a column that has been dropped rather than being honest that its value is not
 * served.
 */
import { describe, expect, it } from "vitest";
import { statusEntry, STATUS_VOCABULARIES } from "@magna-carta/design-system/status-register";
import { ledgerRecordMenu, type LedgerRecord } from "../src/lib/records/ledger-record-menu.ts";
import { isEnabled, menuItem } from "../src/lib/records/record-menu-model.ts";
import type { TimeEntrySummary } from "../src/lib/matters/time-api.ts";
import { statusLabel } from "../src/lib/matters/time-api.ts";
import {
  TIME_COLUMN_IDENTIFIERS,
  TIME_STATUS_CHOICES,
  UNSERVED_TIME_COLUMNS,
  chargeAmount,
  durationParts,
  firmTimeColumns,
  isUnservedColumn,
  timeLedgerColumns,
  timekeeperOf,
  unservedCellTitle,
} from "../src/lib/time/time-columns.ts";
import { personInitials } from "@magna-carta/design-system/formatters";
import {
  countable,
  footerFigures,
  ledgerCurrency,
  matterTimeSummary,
  selectionSummary,
} from "../src/lib/time/time-figures.ts";

/** How the firm screen's Matter column would name a row, for a test that only needs the shape. */
const matterIdOf = (target: TimeEntrySummary): string => target.matterId;

function entry(overrides: Partial<TimeEntrySummary> = {}): TimeEntrySummary {
  return {
    id: "timeEntry_one",
    matterId: "matter_one",
    timekeeperUserId: "user_osei",
    workDate: "2026-08-12",
    durationMinutes: 90,
    rawDurationMinutes: 84,
    narrative: "Reviewed the defect schedule and drafted the response.",
    billable: true,
    amountMinor: 45_000,
    currency: "USD",
    status: "draft",
    timekeeperName: "R. Osei",
    ...overrides,
  };
}

const columns = timeLedgerColumns("USD");
const columnById = (id: string) => {
  const found = columns.find((column) => column.id === id);
  if (found === undefined) throw new Error(`no column ${id}`);
  return found;
};

describe("the ledger's columns", () => {
  it("keeps every column the design names, including the ones nothing fills yet", () => {
    expect(columns.map((column) => column.label)).toEqual([
      "Date",
      "Entry Number",
      "Date Entered",
      "Timekeeper",
      "Description",
      "Category",
      "Activity",
      "Worked",
      "Hours",
      "Rate",
      "Amount",
      "Billable",
      "Attachments",
      "Status",
    ]);
  });

  it("anchors on the work date and lets nothing else claim the anchor", () => {
    expect(columns.filter((column) => column.anchored === true).map((column) => column.id)).toEqual(
      [TIME_COLUMN_IDENTIFIERS.workDate],
    );
  });

  it("sums the three numeric columns and nothing else", () => {
    expect(columns.filter((column) => column.total === "sum").map((column) => column.id)).toEqual([
      TIME_COLUMN_IDENTIFIERS.worked,
      TIME_COLUMN_IDENTIFIERS.hours,
      TIME_COLUMN_IDENTIFIERS.amount,
    ]);
  });

  it("says on the hover what an unserved cell is waiting on, rather than reading as empty", () => {
    for (const id of Object.keys(UNSERVED_TIME_COLUMNS)) {
      expect(isUnservedColumn(id)).toBe(true);
      const title = unservedCellTitle(id);
      expect(title).toContain("not recorded yet");
      expect(title).toContain("Waiting on");
    }
    expect(isUnservedColumn(TIME_COLUMN_IDENTIFIERS.hours)).toBe(false);
    expect(unservedCellTitle(TIME_COLUMN_IDENTIFIERS.hours)).toBe("");
  });

  it("offers no filter on a column whose values cannot be read", () => {
    for (const id of Object.keys(UNSERVED_TIME_COLUMNS)) {
      expect(columnById(id).filter).toBe("none");
    }
  });

  it("offers every status on the Status filter whether or not a loaded row carries it", () => {
    expect(columnById(TIME_COLUMN_IDENTIFIERS.status).filterValues).toEqual(
      TIME_STATUS_CHOICES.map((choice) => choice.label),
    );
    expect(TIME_STATUS_CHOICES.map((choice) => choice.value)).toEqual([
      "draft",
      "submitted",
      "approved",
      "billed",
      "void",
    ]);
  });

  it("offers the roster on the firm screen's Timekeeper filter only where the reader may ask", () => {
    const supervisor = firmTimeColumns("USD", matterIdOf, { timekeeperNames: ["Alba", "Wren"] });
    expect(
      supervisor.find((column) => column.id === TIME_COLUMN_IDENTIFIERS.timekeeper)?.filterValues,
    ).toEqual(["Alba", "Wren"]);
    // Without the capability the column offers nothing beyond what the rows carry: a list of
    // colleagues a reader cannot ask for is an inventory of what they cannot have.
    const own = firmTimeColumns("USD", matterIdOf);
    expect(
      own.find((column) => column.id === TIME_COLUMN_IDENTIFIERS.timekeeper)?.filterValues,
    ).toBeUndefined();
    // The Matter column follows the date on the firm's screen.
    expect(own[1]?.id).toBe(TIME_COLUMN_IDENTIFIERS.matter);
  });

  it("starts a column nobody can fill hidden, so the default table is not a field of dashes", () => {
    for (const id of Object.keys(UNSERVED_TIME_COLUMNS)) {
      expect(columnById(id).hidden).toBe(true);
    }
  });

  it("holds the hours columns in hours, so a range filter reads in the unit its note names", () => {
    const hours = columnById(TIME_COLUMN_IDENTIFIERS.hours);
    expect(hours.value(entry())).toBe(1.5);
    expect(hours.filterNote).toBe("In hours, as billed.");
    const worked = columnById(TIME_COLUMN_IDENTIFIERS.worked);
    expect(worked.value(entry())).toBeCloseTo(1.4);
    expect(worked.filterNote).toBe("In hours, as worked.");
  });

  it("holds the amount in the currency a reader types, not in minor units", () => {
    expect(columnById(TIME_COLUMN_IDENTIFIERS.amount).value(entry())).toBe(450);
    // Nothing charged is an absent value, which sorts last and totals to nothing.
    expect(columnById(TIME_COLUMN_IDENTIFIERS.amount).value(entry({ billable: false }))).toBeNull();
  });

  it("totals hours in both literacies, because that is how a duration renders anywhere", () => {
    const hours = columnById(TIME_COLUMN_IDENTIFIERS.hours);
    expect(hours.totalText?.(12.5)).toBe("12.50 (12:30)");
  });

  it("renders a duration decimal-first with the clock form beside it", () => {
    expect(durationParts(90)).toEqual({ decimal: "1.50", clock: "1:30", text: "1.50 (1:30)" });
    // Zero is a real duration, never a blank: an entry may legitimately hold no time yet.
    expect(durationParts(0).decimal).toBe("0.00");
  });
});

describe("what a cell says about money and about people", () => {
  it("answers 'nothing charged' as null, so no surface can render it as a zero", () => {
    expect(chargeAmount(entry({ billable: false, amountMinor: null }))).toBeNull();
    // A billable entry the server has priced answers in the currency's major unit.
    expect(chargeAmount(entry())).toBe(450);
  });

  it("keeps a departed colleague's name on their own work", () => {
    expect(timekeeperOf(entry({ timekeeperName: "H. Vance" }))).toBe("H. Vance");
  });

  it("states the gap rather than inventing a name where the record kept none", () => {
    expect(timekeeperOf(entry({ timekeeperName: null }))).toBe("Not recorded");
    // A stored first-person stand-in is data loss, and is shown as the gap it is.
    expect(timekeeperOf(entry({ timekeeperName: "You" }))).toBe("Not recorded");
  });

  it("draws initials from the name beside it, never instead of it", () => {
    expect(personInitials("R. Osei")).toBe("RO");
    expect(personInitials("Eleanor")).toBe("E");
    expect(personInitials("")).toBe("");
  });
});

describe("the figures, and their scope", () => {
  const ledger: readonly TimeEntrySummary[] = [
    entry({ id: "a", amountMinor: 45_000, status: "draft" }),
    entry({ id: "b", amountMinor: 30_000, status: "billed" }),
    entry({ id: "c", amountMinor: 90_000, status: "void" }),
    entry({ id: "d", amountMinor: null, billable: false, durationMinutes: 60 }),
  ];

  it("leaves a void out of everything it counts", () => {
    expect(countable(ledger).map((row) => row.id)).toEqual(["a", "b", "d"]);
  });

  it("splits the money into what a bill has taken up and what it has not", () => {
    const figures = footerFigures(ledger, { filtered: false });
    expect(figures.map((figure) => [figure.label, figure.amountMinor])).toEqual([
      ["unbilled", 45_000],
      ["billed", 30_000],
    ]);
  });

  it("says on the hover when a figure speaks for the rows in view rather than the matter", () => {
    const whole = footerFigures(ledger, { filtered: false });
    const inView = footerFigures(ledger, { filtered: true });
    expect(whole[0]?.caption).not.toContain("in view");
    expect(inView[0]?.caption).toContain("in view");
  });

  it("summarises the matter with the void counted separately, never silently", () => {
    const summary = matterTimeSummary(ledger);
    expect(summary.liveCount).toBe(3);
    expect(summary.voidCount).toBe(1);
    expect(summary.billedHours).toBe("4.00 (4:00)");
    expect(summary.nonBillableHours).toBe("1.00 (1:00)");
    expect(summary.byTimekeeper).toHaveLength(1);
  });

  it("tells a selection that its amount left a void out", () => {
    const withVoid = selectionSummary(ledger, (status) => statusEntry(status).label);
    expect(withVoid.excludesVoids).toBe(true);
    expect(withVoid.amountMinor).toBe(75_000);
    expect(withVoid.statusLine).toBe("2 draft · 1 billed · 1 void");

    const withoutVoid = selectionSummary(
      [ledger[0] as TimeEntrySummary],
      (status) => statusEntry(status).label,
    );
    expect(withoutVoid.excludesVoids).toBe(false);
  });

  it("reads the currency off the matter's own entries", () => {
    expect(ledgerCurrency([entry({ currency: "GBP" })])).toBe("GBP");
    expect(ledgerCurrency([])).toBe("USD");
  });
});

describe("the status vocabulary is the product's one register", () => {
  it("gives every word in the chain a tone, not only the withdrawn one", () => {
    const tones = STATUS_VOCABULARIES.workflowChain.map((key) => statusEntry(key).tone);
    expect(tones).toEqual(["neutral", "warning", "success", "info", "danger"]);
  });

  it("takes a time entry's word from the register rather than spelling a second copy", () => {
    for (const key of STATUS_VOCABULARIES.workflowChain) {
      expect(statusLabel(key)).toBe(statusEntry(key).label);
    }
  });
});

describe("the bill a billed record reached", () => {
  /** One ledger row as the shared catalogue speaks for it, whichever surface it came from. */
  function record(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
    return {
      identifier: "timeEntry_one",
      status: "draft",
      entryNumber: null,
      description: "Attended to the matter",
      amount: "$250.00",
      ...overrides,
    };
  }

  const asTime = (target: LedgerRecord) =>
    ledgerRecordMenu([target], target, {
      recordNoun: { singular: "Time Entry", plural: "Time Entries" },
      reviewGateEnabled: false,
      opensTheBill: true,
    });

  it("is one verb in the shared catalogue, not one per ledger", () => {
    // Built on the cost ledger first and lifted rather than copied: two menus answering one
    // question is two chances to word the refusal differently.
    const billed = record({ status: "billed", invoiceId: "invoice_one" });
    const verb = menuItem(asTime(billed), "openBill");
    expect(verb).not.toBeNull();
    expect(verb === null ? false : isEnabled(verb)).toBe(true);
  });

  it("stays on an unbilled entry, refused, rather than appearing and disappearing", () => {
    const verb = menuItem(asTime(record()), "openBill");
    expect(verb).not.toBeNull();
    expect(verb === null ? true : isEnabled(verb)).toBe(false);
    // The refusal is worded in the surface's own noun, from the shared catalogue's one sentence.
    expect(verb?.kind === "action" ? verb.disabledReason : undefined).toContain("time entry");
  });

  it("is absent entirely on a ledger that has nowhere to send a reader", () => {
    // The Fees ledger declares no opensTheBill, because an unbilled fee record has no table behind
    // it yet. A menu that advertised an act the surface cannot perform is worse than one that does
    // not mention it — the same rule the move and the restore already follow.
    const fees = ledgerRecordMenu([record()], record(), {
      recordNoun: { singular: "Fee", plural: "Fees" },
      reviewGateEnabled: false,
    });
    expect(menuItem(fees, "openBill")).toBeNull();
    // Everything else the ledger shares is untouched by the absence.
    expect(menuItem(fees, "open")).not.toBeNull();
    expect(menuItem(fees, "void")).not.toBeNull();
  });
});
