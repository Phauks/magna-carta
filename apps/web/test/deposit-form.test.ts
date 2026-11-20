/*
 * The Record a Payment form's rules: what picking a matter or bill fills in, how the "..." menu's
 * line controls reorder the register, what the totals add to, what is refused, and what is sent.
 * The screen draws these answers and decides none of them.
 */
import { describe, expect, it } from "vitest";
import { DepositForm, fieldId, tidyAmount } from "$lib/payments/deposit-form.svelte.ts";
import { GALLERY_BILLS } from "$lib/payments/record-payment-gallery-fixtures.ts";

const TODAY = "2026-11-20";

function form(): DepositForm {
  return new DepositForm({
    bills: () => GALLERY_BILLS,
    today: TODAY,
    depositToAccountId: "acct-main",
  });
}

function firstLine(deposit: DepositForm) {
  const line = deposit.lines[0];
  if (line === undefined) throw new Error("the form starts with one line");
  return line;
}

describe("picking a matter and a bill", () => {
  it("picks a matter's only bill and fills the amount owed and who paid", () => {
    const deposit = form();
    const line = firstLine(deposit);
    deposit.pickMatter(line, "mat-041");
    expect(line.invoiceId).toBe("inv-420");
    expect(line.amountText).toBe("1,200.00");
    expect(line.receivedFrom).toBe("Dana Ruiz");
  });

  it("leaves the bill open when the matter has more than one", () => {
    const deposit = form();
    const line = firstLine(deposit);
    deposit.pickMatter(line, "mat-113");
    expect(line.invoiceId).toBe("");
    deposit.pickBill(line, "inv-413");
    expect(line.amountText).toBe("3,825.00");
  });

  it("fills a second line on the same bill with only what is still owed", () => {
    const deposit = form();
    const line = firstLine(deposit);
    deposit.pickMatter(line, "mat-113");
    deposit.pickBill(line, "inv-413");
    line.amountText = "3,000.00";
    const second = deposit.addLine();
    if (second === null) throw new Error("a second line fits");
    deposit.pickMatter(second, "mat-113");
    deposit.pickBill(second, "inv-413");
    expect(second.amountText).toBe("825.00");
  });

  it("drops details the new method does not carry", () => {
    const deposit = form();
    const line = firstLine(deposit);
    line.details = { bank: "Wells Fargo", checkDate: "2026-11-17" };
    deposit.pickMethod(line, "ach");
    expect(line.details).toEqual({ bank: "Wells Fargo" });
  });
});

describe("the line menu", () => {
  it("duplicates a line below itself with a new key", () => {
    const deposit = form();
    const line = firstLine(deposit);
    deposit.pickMatter(line, "mat-041");
    line.reference = "R-1";
    deposit.addLine();
    const twin = deposit.duplicateLine(line.key);
    expect(deposit.lines).toHaveLength(3);
    expect(deposit.lines[1]).toBe(twin);
    expect(twin?.key).not.toBe(line.key);
    expect(twin?.matterId).toBe("mat-041");
    expect(twin?.reference).toBe("R-1");
  });

  it("moves a line up and down, and stops at the ends", () => {
    const deposit = form();
    const one = firstLine(deposit);
    const two = deposit.addLine();
    if (two === null) throw new Error("a second line fits");
    deposit.moveLine(two.key, -1);
    expect(deposit.lines.map((line) => line.key)).toEqual([two.key, one.key]);
    deposit.moveLine(two.key, -1);
    expect(deposit.lines.map((line) => line.key)).toEqual([two.key, one.key]);
    deposit.moveLine(two.key, 1);
    expect(deposit.lines.map((line) => line.key)).toEqual([one.key, two.key]);
  });

  it("clears a line in place and never leaves the register empty", () => {
    const deposit = form();
    const line = firstLine(deposit);
    deposit.pickMatter(line, "mat-041");
    deposit.clearLine(line.key);
    expect(deposit.lines).toHaveLength(1);
    expect(firstLine(deposit).matterId).toBe("");
    deposit.removeLine(firstLine(deposit).key);
    expect(deposit.lines).toHaveLength(1);
  });
});

describe("totals", () => {
  it("adds the lines and takes the bank fees off the deposit", () => {
    const deposit = form();
    const line = firstLine(deposit);
    deposit.pickMatter(line, "mat-041");
    line.amountText = "1,000.00";
    const cash = deposit.addLine();
    if (cash === null) throw new Error("a second line fits");
    deposit.pickMethod(cash, "cash");
    cash.cashCount = { bill2000: "4", coin25: "3" };
    const fee = deposit.addFee();
    if (fee === null) throw new Error("a fee fits");
    fee.amountText = "15.00";
    expect(cash.amountMinor).toBe(8075);
    expect(deposit.paymentsMinor).toBe(108075);
    expect(deposit.feesMinor).toBe(1500);
    expect(deposit.depositMinor).toBe(106575);
  });

  it("writes typed amounts back with commas", () => {
    expect(tidyAmount("1500")).toBe("1,500.00");
    expect(tidyAmount("abc")).toBe("abc");
  });
});

describe("refusals", () => {
  it("refuses a line paying more than its bill owes, and a missing check number", () => {
    const deposit = form();
    const line = firstLine(deposit);
    deposit.pickMatter(line, "mat-041");
    line.amountText = "1,500.00";
    const refusals = deposit.refusals;
    expect(refusals.get(fieldId.line(line.key, "amount"))).toMatch(/more than bill 00420/);
    expect(refusals.get(fieldId.line(line.key, "reference"))).toMatch(/Check No\./);
  });

  it("refuses a date received after the date deposited", () => {
    const deposit = form();
    const line = firstLine(deposit);
    deposit.depositedOn = "2026-11-18";
    line.receivedOn = "2026-11-19";
    expect(deposit.refusals.get(fieldId.line(line.key, "received"))).toMatch(/after the date/);
  });

  it("asks for the account the money went into", () => {
    const deposit = form();
    deposit.depositToAccountId = "";
    expect(deposit.firstRefusal).toBe("Choose the account the money went into.");
  });

  it("refuses bank fees as large as the payments", () => {
    const deposit = form();
    const line = firstLine(deposit);
    deposit.pickMatter(line, "mat-041");
    line.amountText = "10.00";
    const fee = deposit.addFee();
    if (fee === null) throw new Error("a fee fits");
    fee.description = "Item fee";
    fee.amountText = "10.00";
    expect(deposit.refusals.get(fieldId.fee(fee.key, "amount"))).toMatch(/more than the payments/);
  });
});

describe("what is sent", () => {
  it("sends each line with its matter, bill, details and counted cash", () => {
    const deposit = form();
    deposit.slipNumber = " DS-1 ";
    const line = firstLine(deposit);
    deposit.pickMatter(line, "mat-041");
    deposit.pickMethod(line, "cash");
    line.amountText = "";
    line.cashCount = { bill10000: "2", bill500: "0" };
    line.details = { receivedBy: " Pat Lee ", countedBy: "" };
    const request = deposit.toRequest();
    expect(request.slipNumber).toBe("DS-1");
    expect(request.lines[0]).toMatchObject({
      matterId: "mat-041",
      invoiceId: "inv-420",
      method: "cash",
      amountMinor: 20000,
      receivedFrom: "Dana Ruiz",
      reference: null,
      details: { receivedBy: "Pat Lee", cashCount: { bill10000: 2 } },
    });
  });
});
