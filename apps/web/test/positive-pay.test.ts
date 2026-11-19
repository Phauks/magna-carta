import { describe, expect, it } from "vitest";
import {
  formulaSafe,
  isAccountNumber,
  positivePayCountText,
  positivePayCsv,
  positivePayFilename,
  positivePayRows,
  type PositivePayRow,
} from "../src/lib/trust/checks/positive-pay.ts";
import type { TrustCheckRegisterRow } from "../src/lib/trust/checks/checks-api.ts";

const NOVEMBER = { from: "2026-11-01", to: "2026-11-19", timeZone: "UTC" } as const;

function check(
  checkNumber: number,
  status: TrustCheckRegisterRow["status"],
  numberedAt: string,
  lastEventAt: string | null = null,
  overrides: Partial<TrustCheckRegisterRow> = {},
): TrustCheckRegisterRow {
  return {
    trustCheckId: `trustCheck_${checkNumber}`,
    checkNumber,
    status,
    trustMovementId: `trustMovement_${checkNumber}`,
    payee: "Maria Delgado",
    amountMinor: 1_840_000,
    currency: "USD",
    effectiveDate: null,
    matterNumber: "26-0087",
    matterTitle: "Delgado Settlement",
    memo: "Settlement share",
    numberedBy: "user_okafor",
    numberedAt,
    settledReason: null,
    lastEventAt,
    ...overrides,
  };
}

function row(overrides: Partial<PositivePayRow> = {}): PositivePayRow {
  return {
    checkNumber: 10_419,
    issueDate: "2026-11-03",
    amountMinor: 1_840_000,
    currency: "USD",
    payee: "Maria Delgado",
    voided: false,
    ...overrides,
  };
}

describe("positivePayRows", () => {
  it("includes a check issued on either end of the range and leaves out one issued outside it", () => {
    const rows = positivePayRows(
      [
        check(1, "printed", "2026-10-31T23:00:00.000Z", "2026-10-31T23:05:00.000Z"),
        check(2, "printed", "2026-11-01T00:00:00.000Z", "2026-11-01T00:05:00.000Z"),
        check(3, "numbered", "2026-11-19T23:59:00.000Z"),
        check(4, "printed", "2026-11-20T00:00:00.000Z", "2026-11-20T00:05:00.000Z"),
      ],
      NOVEMBER,
    );
    expect(rows.map((included) => included.checkNumber)).toEqual([2, 3]);
  });

  it("includes an older check voided in the range, and leaves out a void outside it", () => {
    const rows = positivePayRows(
      [
        check(10, "voided", "2026-10-14T16:00:00.000Z", "2026-11-10T16:00:00.000Z"),
        check(11, "spoiled", "2026-10-14T16:00:00.000Z", "2026-10-20T16:00:00.000Z"),
        check(12, "spoiled", "2026-09-01T16:00:00.000Z", "2026-11-19T10:00:00.000Z"),
      ],
      NOVEMBER,
    );
    expect(rows.map((included) => [included.checkNumber, included.voided])).toEqual([
      [10, true],
      [12, true],
    ]);
  });

  it("does not take a printed check's last event as a void", () => {
    const rows = positivePayRows(
      [check(5, "printed", "2026-10-14T16:00:00.000Z", "2026-11-05T16:00:00.000Z")],
      NOVEMBER,
    );
    expect(rows).toEqual([]);
  });

  it("reads the day of a recorded moment in the reader's zone", () => {
    // 03:00 UTC on the 1st is still the 31st in Los Angeles.
    const register = [check(6, "printed", "2026-11-01T03:00:00.000Z", "2026-11-01T03:00:00.000Z")];
    expect(positivePayRows(register, NOVEMBER)).toHaveLength(1);
    expect(positivePayRows(register, { ...NOVEMBER, timeZone: "America/Los_Angeles" })).toEqual([]);
  });

  it("dates a check by its effective date, else the day its number was used", () => {
    const rows = positivePayRows(
      [
        check(7, "printed", "2026-11-04T16:00:00.000Z", null, { effectiveDate: "2026-11-02" }),
        check(8, "printed", "2026-11-04T16:00:00.000Z", null, { effectiveDate: null }),
      ],
      NOVEMBER,
    );
    expect(rows.map((included) => included.issueDate)).toEqual(["2026-11-02", "2026-11-04"]);
  });

  it("lists a number voided before anything printed on it as a void for nothing", () => {
    const rows = positivePayRows(
      [
        check(9, "voided", "2026-11-06T16:00:00.000Z", "2026-11-06T16:00:00.000Z", {
          trustMovementId: null,
          payee: null,
          amountMinor: null,
          currency: null,
          effectiveDate: null,
        }),
      ],
      NOVEMBER,
    );
    expect(rows).toEqual([
      {
        checkNumber: 9,
        issueDate: "2026-11-06",
        amountMinor: 0,
        currency: "USD",
        payee: "",
        voided: true,
      },
    ]);
    expect(positivePayCsv(rows, "123")).toBe(
      "Account Number,Check Number,Issue Date,Amount,Payee,Void\r\n123,9,2026-11-06,0.00,,Y\r\n",
    );
  });

  it("sorts by check number whatever order the register came in", () => {
    const rows = positivePayRows(
      [
        check(10_421, "printed", "2026-11-05T16:00:00.000Z"),
        check(9_999, "printed", "2026-11-05T16:00:00.000Z"),
        check(10_400, "voided", "2026-11-05T16:00:00.000Z", "2026-11-05T16:00:00.000Z"),
      ],
      NOVEMBER,
    );
    expect(rows.map((included) => included.checkNumber)).toEqual([9_999, 10_400, 10_421]);
  });
});

describe("positivePayCsv", () => {
  it("writes the header and one row per check, every line ending CRLF", () => {
    const csv = positivePayCsv([row(), row({ checkNumber: 10_420, voided: true })], "000123456789");
    expect(csv).toBe(
      "Account Number,Check Number,Issue Date,Amount,Payee,Void\r\n" +
        "000123456789,10419,2026-11-03,18400.00,Maria Delgado,N\r\n" +
        "000123456789,10420,2026-11-03,18400.00,Maria Delgado,Y\r\n",
    );
    expect(csv.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
  });

  it("writes the amount as a plain decimal with two places", () => {
    const amounts = [5, 100, 125_050, 123_456_789].map(
      (amountMinor) =>
        positivePayCsv([row({ amountMinor })], "1")
          .split("\r\n")[1]
          ?.split(",")[3],
    );
    expect(amounts).toEqual(["0.05", "1.00", "1250.50", "1234567.89"]);
  });

  it("quotes a payee with a comma, a quote or a line break, doubling inner quotes", () => {
    const line = (payee: string): string | undefined =>
      positivePayCsv([row({ payee })], "1").split("\r\n")[1];
    expect(line("Nevada Court Reporters, LLC")).toBe(
      '1,10419,2026-11-03,18400.00,"Nevada Court Reporters, LLC",N',
    );
    expect(line('Robert "Bob" Lee')).toBe('1,10419,2026-11-03,18400.00,"Robert ""Bob"" Lee",N');
    expect(positivePayCsv([row({ payee: "Two\nLines" })], "1")).toContain('"Two\nLines"');
  });

  it("leaves out the matter and the memo", () => {
    const csv = positivePayCsv(
      positivePayRows([check(1, "printed", "2026-11-05T16:00:00.000Z")], NOVEMBER),
      "1",
    );
    expect(csv).not.toContain("26-0087");
    expect(csv).not.toContain("Delgado Settlement");
    expect(csv).not.toContain("Settlement share");
  });
});

describe("formulaSafe", () => {
  it("puts an apostrophe before a payee a spreadsheet would run", () => {
    for (const payee of [
      "=SUM(A1)",
      "+1 Holdings",
      "-Dash Co",
      "@Mention",
      "\tTabbed",
      "\rReturn",
    ]) {
      expect(formulaSafe(payee)).toBe(`'${payee}`);
    }
    expect(formulaSafe("Maria Delgado")).toBe("Maria Delgado");
    expect(formulaSafe("A=B")).toBe("A=B");
  });

  it("is applied before quoting", () => {
    const csv = positivePayCsv([row({ payee: '=HYPERLINK("x","y")' })], "1");
    expect(csv.split("\r\n")[1]).toBe(`1,10419,2026-11-03,18400.00,"'=HYPERLINK(""x"",""y"")",N`);
  });
});

describe("the dialog's words and checks", () => {
  it("counts the checks and the voids", () => {
    expect(positivePayCountText([])).toBe("No checks in these dates");
    expect(positivePayCountText([row()])).toBe("1 check");
    expect(positivePayCountText([row(), row(), row(), row({ voided: true })])).toBe(
      "4 checks, 1 voided",
    );
  });

  it("takes an account number of digits only", () => {
    expect(isAccountNumber("000123456789")).toBe(true);
    expect(isAccountNumber("")).toBe(false);
    expect(isAccountNumber("1234 5678")).toBe(false);
    expect(isAccountNumber("12-34")).toBe(false);
  });

  it("names the file after the account and the dates", () => {
    expect(positivePayFilename("IOLTA Client Trust", "2026-11-01", "2026-11-19")).toBe(
      "positive-pay-iolta-client-trust-2026-11-01-to-2026-11-19.csv",
    );
  });
});
