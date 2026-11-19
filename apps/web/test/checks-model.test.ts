import { describe, expect, it } from "vitest";
import { MICR_BAND_TOP_MILS, fieldHeightMils } from "@magna-carta/trust/check-layout";
import {
  addedField,
  checkRunText,
  checkStatusLabel,
  checkStatusTone,
  clampedPosition,
  clampedWidth,
  kindsToAdd,
  markPrintedLabel,
  milsFromInches,
  nextUnusedNumber,
  numberAlreadyUsed,
  openedToPrintText,
  previewNumbers,
  printButtonLabel,
  printableChecks,
  printedRows,
  settledReasonText,
  shiftProblem,
  typedCheckNumber,
  voidedRows,
} from "../src/lib/trust/checks/checks-model.ts";
import type {
  TrustCheckRegisterRow,
  TrustCheckToPrint,
} from "../src/lib/trust/checks/checks-api.ts";

function row(checkNumber: number, status: TrustCheckRegisterRow["status"]): TrustCheckRegisterRow {
  return {
    trustCheckId: `trustCheck_${checkNumber}`,
    checkNumber,
    status,
    trustMovementId: null,
    payee: null,
    amountMinor: null,
    currency: null,
    effectiveDate: null,
    matterNumber: null,
    matterTitle: null,
    memo: null,
    numberedBy: "user_a",
    numberedAt: "2026-11-01T00:00:00.000Z",
    settledReason: null,
    lastEventAt: null,
  };
}

describe("the register's three lists", () => {
  const register = [
    row(3, "numbered"),
    row(1, "printed"),
    row(2, "spoiled"),
    row(4, "voided"),
    row(0, "numbered"),
  ];

  it("puts printed and older numbered checks on Printed, spoiled and voided on Voided", () => {
    expect(printedRows(register).map((entry) => entry.checkNumber)).toEqual([3, 1, 0]);
    expect(voidedRows(register).map((entry) => entry.checkNumber)).toEqual([2, 4]);
  });

  it("shows an older numbered check exactly like a printed one", () => {
    expect(checkStatusLabel("numbered")).toBe("Printed");
    expect(checkStatusTone("numbered")).toBe(checkStatusTone("printed"));
  });

  it("shows an older misprint as Voided, with Misprinted as its reason", () => {
    expect(checkStatusLabel("spoiled")).toBe("Voided");
    expect(checkStatusTone("spoiled")).toBe(checkStatusTone("voided"));
    const misprint = { status: "spoiled" as const, settledReason: "Spoiled in printing" };
    expect(settledReasonText(misprint)).toBe("Misprinted");
    expect(settledReasonText({ status: "voided", settledReason: "Lost in the mail" })).toBe(
      "Lost in the mail",
    );
  });
});

describe("the check numbers", () => {
  it("prints the next check on the first unused number at or after the one set, lower included", () => {
    expect(nextUnusedNumber(10_401, [10_418, 10_419])).toBe(10_401);
    expect(nextUnusedNumber(10_418, [10_418, 10_419, 10_421])).toBe(10_420);
  });

  it("reads a typed check number as a whole number from 1", () => {
    expect(typedCheckNumber(" 10422 ")).toBe(10_422);
    expect(typedCheckNumber("0")).toBeNull();
    expect(typedCheckNumber("104.5")).toBeNull();
    expect(typedCheckNumber("")).toBeNull();
  });

  it("reads a run of check numbers", () => {
    expect(checkRunText(10_422, 3)).toBe("10422 to 10424");
    expect(checkRunText(10_422, 1)).toBe("10422");
  });

  it("knows the server's refusal of a used number", () => {
    expect(
      numberAlreadyUsed(
        "Check 10422 is already in this account's register. A check number is never used twice.",
      ),
    ).toBe(true);
    expect(numberAlreadyUsed("no stock is saved")).toBe(false);
    expect(numberAlreadyUsed(undefined)).toBe(false);
  });
});

describe("previewing numbers", () => {
  it("numbers the chosen payments in the order shown, from the first check number", () => {
    const previews = previewNumbers(["b", "a"], 10_422);
    expect(previews.get("b")).toBe(10_422);
    expect(previews.get("a")).toBe(10_423);
  });
});

function waiting(identifier: string, payee: string, amountMinor: number): TrustCheckToPrint {
  return {
    trustMovementId: identifier,
    payee,
    amountMinor,
    currency: "USD",
    memo: `Memo for ${payee}`,
    effectiveDate: "2026-10-31",
    authorizedBy: "user_whitfield",
    matterNumber: "26-0141",
    matterTitle: "Harrington Purchase",
    earlierCheckNumbers: [],
  };
}

describe("the checks opened to print", () => {
  const toPrint = [
    waiting("a", "Desert Title Company", 300_000),
    waiting("b", "Jordan Smith", 125_050),
    waiting("c", "Clark County Recorder", 8_400),
  ];

  it("numbers the chosen payments from the first check number, in the order given", () => {
    const checks = printableChecks(toPrint, ["c", "a"], 10_422);
    expect(checks.map((check) => [check.checkNumber, check.payee])).toEqual([
      [10_422, "Clark County Recorder"],
      [10_423, "Desert Title Company"],
    ]);
  });

  it("matches the previewed numbers the print route will record", () => {
    const order = ["b", "c", "a"];
    const previews = previewNumbers(order, 500);
    const checks = printableChecks(toPrint, order, 500);
    expect(checks.map((check) => check.checkNumber)).toEqual(
      order.map((identifier) => previews.get(identifier)),
    );
  });

  it("prints what the waiting payment says", () => {
    expect(printableChecks(toPrint, ["b"], 7)).toEqual([
      {
        checkNumber: 7,
        payee: "Jordan Smith",
        amountMinor: 125_050,
        effectiveDate: "2026-10-31",
        memo: "Memo for Jordan Smith",
        matterNumber: "26-0141",
        matterTitle: "Harrington Purchase",
      },
    ]);
  });

  it("leaves out a payment that is no longer waiting", () => {
    expect(printableChecks(toPrint, ["gone", "a"], 10).map((check) => check.payee)).toEqual([
      "Desert Title Company",
    ]);
  });

  it("names the buttons and the waiting line by count", () => {
    expect(printButtonLabel(0)).toBe("Print Checks");
    expect(printButtonLabel(1)).toBe("Print 1 Check");
    expect(printButtonLabel(3)).toBe("Print 3 Checks");
    expect(markPrintedLabel(1)).toBe("Mark 1 Printed");
    expect(markPrintedLabel(3)).toBe("Mark 3 Printed");
    expect(openedToPrintText(10_422, 1)).toBe("Check 10422 opened to print.");
    expect(openedToPrintText(10_422, 3)).toBe("Checks 10422 to 10424 opened to print.");
  });
});

describe("the editor's inches", () => {
  it("reads typed inches as whole thousandths, and refuses what is not a number", () => {
    expect(milsFromInches("1.15")).toBe(1_150);
    expect(milsFromInches(" .5 ")).toBe(500);
    expect(milsFromInches("-0.25")).toBe(-250);
    expect(milsFromInches("")).toBeNull();
    expect(milsFromInches("1.2.3")).toBeNull();
    expect(milsFromInches("one")).toBeNull();
  });

  it("refuses a whole page shift past half an inch", () => {
    expect(shiftProblem(500)).toBe(false);
    expect(shiftProblem(-501)).toBe(true);
  });

  it("stops a dragged field at the MICR band and the check's edges", () => {
    const field = addedField("memo");
    const landed = clampedPosition(field, -40, 9_000);
    expect(landed.xMils).toBe(0);
    expect(landed.yMils).toBe(MICR_BAND_TOP_MILS - fieldHeightMils(field.sizePoints));
    expect(clampedWidth(field, 100)).toBe(300);
    expect(clampedWidth(field, 99_999)).toBe(8_500 - field.xMils);
  });

  it("offers only the kinds not yet on the layout", () => {
    expect(kindsToAdd([addedField("date"), addedField("payee")])).toEqual([
      "amount",
      "amount_words",
      "memo",
      "matter",
      "check_number",
    ]);
  });
});
