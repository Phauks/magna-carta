import { describe, expect, it } from "vitest";
import { MICR_BAND_TOP_MILS, fieldHeightMils } from "@magna-carta/trust/check-layout";
import {
  addedField,
  answerConsequence,
  checkStatusLabel,
  clampedPosition,
  clampedWidth,
  joinedNames,
  kindsToAdd,
  loadPaperLine,
  milsFromInches,
  nextUnusedNumber,
  numberAlreadyUsed,
  paymentsToReprint,
  previewNumbers,
  printedRows,
  settledReasonText,
  shiftProblem,
  typedCheckNumber,
  voidedRows,
  waitingRows,
} from "../src/lib/trust/checks/checks-model.ts";
import type { TrustCheckRegisterRow } from "../src/lib/trust/checks/checks-api.ts";

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

  it("puts printed and unanswered numbers on Printed, misprinted and voided on Voided", () => {
    expect(printedRows(register).map((entry) => entry.checkNumber)).toEqual([3, 1, 0]);
    expect(voidedRows(register).map((entry) => entry.checkNumber)).toEqual([2, 4]);
  });

  it("lists the unanswered checks oldest number first", () => {
    expect(waitingRows(register).map((entry) => entry.checkNumber)).toEqual([0, 3]);
  });

  it("calls a misprint Misprinted, whatever the older reason said", () => {
    expect(checkStatusLabel("spoiled")).toBe("Misprinted");
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

  it("says which paper to load", () => {
    expect(loadPaperLine(10_422, 3)).toBe(
      "Load checks 10422 to 10424 in the printer, facing the way your printer takes them.",
    );
    expect(loadPaperLine(10_422, 1)).toBe(
      "Load check 10422 in the printer, facing the way your printer takes it.",
    );
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
  it("numbers the chosen payments in the order shown, from the next number", () => {
    const previews = previewNumbers(["b", "a"], 10_422);
    expect(previews.get("b")).toBe(10_422);
    expect(previews.get("a")).toBe(10_423);
  });
});

describe("what answering will do", () => {
  const checks = [
    {
      trustCheckId: "one",
      checkNumber: 10_422,
      payee: "Desert Title Company",
      amountText: "",
      trustMovementId: "a",
    },
    {
      trustCheckId: "two",
      checkNumber: 10_423,
      payee: "Jordan Smith",
      amountText: "",
      trustMovementId: "b",
    },
    {
      trustCheckId: "three",
      checkNumber: 10_424,
      payee: "Jordan Smith",
      amountText: "",
      trustMovementId: "c",
    },
  ];

  it("says every check will be recorded as printed when none is misprinted", () => {
    expect(answerConsequence(checks, {})).toBe("All 3 will be recorded as printed.");
    expect(answerConsequence(checks.slice(0, 1), {})).toBe("10422 will be recorded as printed.");
  });

  it("names the misprinted numbers and each payee once", () => {
    expect(answerConsequence(checks, { three: "spoiled" })).toBe(
      "10424 will be voided as misprinted, and you can print Jordan Smith again on the next number.",
    );
    expect(answerConsequence(checks, { one: "spoiled", two: "spoiled", three: "spoiled" })).toBe(
      "10422, 10423 and 10424 will be voided as misprinted, and you can print Desert Title Company and Jordan Smith again on the next number.",
    );
  });

  it("hands back the misprinted checks' payments to print again, in number order", () => {
    expect(paymentsToReprint(checks, { three: "spoiled", one: "spoiled" })).toEqual(["a", "c"]);
    expect(paymentsToReprint(checks, {})).toEqual([]);
  });

  it("joins names the way a sentence does", () => {
    expect(joinedNames([])).toBe("");
    expect(joinedNames(["A"])).toBe("A");
    expect(joinedNames(["A", "B", "C"])).toBe("A, B and C");
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
