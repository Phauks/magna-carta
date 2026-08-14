import { describe, expect, it } from "vitest";
import { ReportingValidationError } from "../src/reporting-validation.ts";
import {
  dayBefore,
  knowledgeBoundOf,
  reproducibilityOf,
  reproducibilityStatement,
  resolveLiveOnlyPeriod,
  resolveReportingPeriod,
} from "../src/temporal.ts";

const NOW = "2026-08-14T12:00:00.000Z";

const codeOf = (run: () => unknown): string => {
  try {
    run();
  } catch (caught) {
    if (caught instanceof ReportingValidationError) return caught.code;
    throw caught;
  }
  throw new Error("expected a refusal");
};

describe("the temporal pair a ledger-backed report is taken over", () => {
  it("accepts a period with a knowledge instant and keeps both", () => {
    const period = resolveReportingPeriod(
      { periodStart: "2026-07-01", periodEnd: "2026-07-31", knownAsOf: "2026-08-01T00:00:00.000Z" },
      NOW,
    );
    expect(period).toEqual({
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      knownAsOf: "2026-08-01T00:00:00.000Z",
    });
  });

  it("treats an omitted knowledge instant as live rather than as an error", () => {
    const period = resolveReportingPeriod(
      { periodStart: "2026-07-01", periodEnd: "2026-07-31" },
      NOW,
    );
    expect(period.knownAsOf).toBeNull();
  });

  it("refuses a period start that is not a calendar date", () => {
    expect(
      codeOf(() =>
        resolveReportingPeriod({ periodStart: "2026-02-30", periodEnd: "2026-07-31" }, NOW),
      ),
    ).toBe("reporting-period-not-a-calendar-date");
  });

  it("refuses an inverted period", () => {
    expect(
      codeOf(() =>
        resolveReportingPeriod({ periodStart: "2026-08-01", periodEnd: "2026-07-31" }, NOW),
      ),
    ).toBe("reporting-period-inverted");
  });

  // A knowledge instant is compared lexicographically against `recorded_at` in SQL, so a value in a
  // different shape would filter wrong rather than fail — quietly dropping rows the caller meant to
  // include. That is why the shape is checked rather than parsed leniently.
  it("refuses a knowledge instant that is not in the shape recorded_at is written in", () => {
    for (const shape of ["2026-08-01", "2026-08-01T00:00:00Z", "2026-08-01T00:00:00+00:00"]) {
      expect(
        codeOf(() =>
          resolveReportingPeriod(
            { periodStart: "2026-07-01", periodEnd: "2026-07-31", knownAsOf: shape },
            NOW,
          ),
        ),
      ).toBe("reporting-knowledge-instant-not-an-instant");
    }
  });

  // Claiming a knowledge instant the platform has not reached would promise reproducibility the
  // triple cannot keep: rows recorded between now and that instant would join the answer later.
  it("refuses a knowledge instant in the future", () => {
    expect(
      codeOf(() =>
        resolveReportingPeriod(
          {
            periodStart: "2026-07-01",
            periodEnd: "2026-07-31",
            knownAsOf: "2026-09-01T00:00:00.000Z",
          },
          NOW,
        ),
      ),
    ).toBe("reporting-knowledge-instant-in-the-future");
  });

  it("validates a live-only period on the same terms, with no knowledge instant to state", () => {
    expect(resolveLiveOnlyPeriod({ periodStart: "2026-07-01", periodEnd: "2026-07-31" })).toEqual({
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });
    expect(
      codeOf(() => resolveLiveOnlyPeriod({ periodStart: "2026-08-01", periodEnd: "2026-07-31" })),
    ).toBe("reporting-period-inverted");
  });
});

describe("the opening-balance date", () => {
  it("is the day before the period starts, so the first day is not counted twice", () => {
    expect(dayBefore("2026-07-01")).toBe("2026-06-30");
  });

  it("steps across a month, a year, and a leap day", () => {
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
    expect(dayBefore("2026-01-01")).toBe("2025-12-31");
    expect(dayBefore("2028-03-01")).toBe("2028-02-29");
  });
});

describe("what a report says about its own reproducibility", () => {
  it("an as-of report is bounded by the stated instant and claims to reproduce", () => {
    const period = resolveReportingPeriod(
      { periodStart: "2026-07-01", periodEnd: "2026-07-31", knownAsOf: "2026-08-01T00:00:00.000Z" },
      NOW,
    );
    expect(knowledgeBoundOf(period, NOW)).toBe("2026-08-01T00:00:00.000Z");
    const reproducibility = reproducibilityOf(period, NOW);
    expect(reproducibility.reproducible).toBe(true);
    expect(reproducibilityStatement(reproducibility)).toContain("returns the same figures");
  });

  // A live report is still bounded — by the instant it was assembled at — so its own sections agree
  // with each other while it is being written. What it does not claim is that a later run agrees
  // with this one, and the statement says exactly that rather than staying silent.
  it("a live report is bounded by the instant it was computed at and says it does not reproduce", () => {
    const period = resolveReportingPeriod(
      { periodStart: "2026-07-01", periodEnd: "2026-07-31" },
      NOW,
    );
    expect(knowledgeBoundOf(period, NOW)).toBe(NOW);
    const reproducibility = reproducibilityOf(period, NOW);
    expect(reproducibility.reproducible).toBe(false);
    expect(reproducibilityStatement(reproducibility)).toContain("not claimed to reproduce");
  });

  // The statement is narrow on purpose: figures reproduce, captions do not. A report that promised
  // the whole document reproduced would be making a claim about mutable rows — a renamed client, a
  // revised rule citation — that the platform cannot keep.
  it("says out loud that names and citations are only as they stood", () => {
    const period = resolveReportingPeriod(
      { periodStart: "2026-07-01", periodEnd: "2026-07-31", knownAsOf: "2026-08-01T00:00:00.000Z" },
      NOW,
    );
    expect(reproducibilityStatement(reproducibilityOf(period, NOW))).toContain(
      "as they stood when this report was produced",
    );
  });
});
