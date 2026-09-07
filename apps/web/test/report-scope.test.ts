/*
 * A report's scope: the named spans against a fixed day (with the year boundary on last quarter
 * and last month), the knowledge-instant day, and the address round-trip.
 */
import { describe, expect, it } from "vitest";
import {
  isPeriodShowing,
  knowledgeDateOf,
  knowledgeInstantForDate,
  readReportScope,
  reportPeriodPreset,
  scopeReading,
  writeReportScope,
  type ReportScope,
} from "../src/lib/reports/report-scope.ts";

const A_JULY_DAY = "2026-07-14";
const A_JANUARY_DAY = "2026-01-09";

describe("named report periods", () => {
  it("spans this month and last month, with the label naming the month", () => {
    expect(reportPeriodPreset("month", A_JULY_DAY)).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
      label: "This month, July 2026",
    });
    expect(reportPeriodPreset("lastMonth", A_JULY_DAY)).toEqual({
      from: "2026-06-01",
      to: "2026-06-30",
      label: "Last month, June 2026",
    });
  });

  it("steps last month into the previous year from January", () => {
    expect(reportPeriodPreset("lastMonth", A_JANUARY_DAY)).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
      label: "Last month, December 2025",
    });
  });

  it("spans calendar quarters, and last quarter from January is the previous year's fourth", () => {
    expect(reportPeriodPreset("quarter", A_JULY_DAY)).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
      label: "This quarter, Q3 2026",
    });
    expect(reportPeriodPreset("lastQuarter", A_JULY_DAY)).toEqual({
      from: "2026-04-01",
      to: "2026-06-30",
      label: "Last quarter, Q2 2026",
    });
    expect(reportPeriodPreset("lastQuarter", A_JANUARY_DAY)).toEqual({
      from: "2025-10-01",
      to: "2025-12-31",
      label: "Last quarter, Q4 2025",
    });
  });

  it("spans whole years", () => {
    expect(reportPeriodPreset("year", A_JULY_DAY).from).toBe("2026-01-01");
    expect(reportPeriodPreset("year", A_JULY_DAY).to).toBe("2026-12-31");
    expect(reportPeriodPreset("lastYear", A_JULY_DAY)).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
      label: "Last year, 2025",
    });
  });

  it("marks the preset whose span is in view", () => {
    const month = reportPeriodPreset("month", A_JULY_DAY);
    expect(isPeriodShowing(month, reportPeriodPreset("month", A_JULY_DAY))).toBe(true);
    expect(isPeriodShowing(month, reportPeriodPreset("quarter", A_JULY_DAY))).toBe(false);
  });
});

describe("the knowledge instant", () => {
  it("is the last millisecond of the chosen day in UTC, and reads back as that day", () => {
    const instant = knowledgeInstantForDate("2026-07-31");
    expect(instant).toBe("2026-07-31T23:59:59.999Z");
    expect(knowledgeDateOf(instant)).toBe("2026-07-31");
  });
});

describe("the address", () => {
  const defaultPeriod = reportPeriodPreset("month", A_JULY_DAY);
  const optionKeys = ["zeroBalanceLedgers", "authorizers"];

  it("round-trips a full scope", () => {
    const scope: ReportScope = {
      period: reportPeriodPreset("lastQuarter", A_JULY_DAY),
      knownAsOf: knowledgeInstantForDate("2026-06-30"),
      subject: "trustAccount_one",
      options: { authorizers: "omit" },
    };
    const url = writeReportScope(
      new URL("https://example.com/reports/trust-compliance"),
      scope,
      optionKeys,
    );
    expect(url.searchParams.get("from")).toBe("2026-04-01");
    expect(url.searchParams.get("to")).toBe("2026-06-30");
    expect(url.searchParams.get("knownAsOf")).toBe("2026-06-30T23:59:59.999Z");
    expect(url.searchParams.get("subject")).toBe("trustAccount_one");
    expect(url.searchParams.get("authorizers")).toBe("omit");
    expect(url.searchParams.has("zeroBalanceLedgers")).toBe(false);

    const read = readReportScope(url.searchParams, defaultPeriod, optionKeys);
    expect(read.period.from).toBe("2026-04-01");
    expect(read.period.to).toBe("2026-06-30");
    expect(read.knownAsOf).toBe("2026-06-30T23:59:59.999Z");
    expect(read.subject).toBe("trustAccount_one");
    expect(read.options).toEqual({ authorizers: "omit" });
  });

  it("falls back to the default period for a span that reads backwards or is not a date", () => {
    const backwards = new URLSearchParams("from=2026-07-31&to=2026-07-01");
    expect(readReportScope(backwards, defaultPeriod, optionKeys).period).toBe(defaultPeriod);
    const garbage = new URLSearchParams("from=july&to=august");
    expect(readReportScope(garbage, defaultPeriod, optionKeys).period).toBe(defaultPeriod);
  });

  it("treats a knowledge instant that is not an instant as live", () => {
    const odd = new URLSearchParams("knownAsOf=2026-07-31");
    expect(readReportScope(odd, defaultPeriod, optionKeys).knownAsOf).toBeNull();
  });

  it("clears a half that is absent when written back", () => {
    const url = new URL(
      "https://example.com/reports/trust-compliance?subject=trustAccount_one&knownAsOf=2026-06-30T23%3A59%3A59.999Z&authorizers=omit",
    );
    const cleared = writeReportScope(
      url,
      { period: defaultPeriod, knownAsOf: null, subject: null, options: {} },
      optionKeys,
    );
    expect(cleared.searchParams.has("subject")).toBe(false);
    expect(cleared.searchParams.has("knownAsOf")).toBe(false);
    expect(cleared.searchParams.has("authorizers")).toBe(false);
  });

  it("reads the scope as one line: the period, then live or fixed", () => {
    expect(
      scopeReading({ period: defaultPeriod, knownAsOf: null, subject: null, options: {} }),
    ).toBe("Jul 1 to 31 · everything known now");
    expect(
      scopeReading({
        period: defaultPeriod,
        knownAsOf: knowledgeInstantForDate("2026-08-01"),
        subject: null,
        options: {},
      }),
    ).toBe("Jul 1 to 31 · as known at the end of 2026-08-01");
  });
});
