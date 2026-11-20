/*
 * Record a Payment over fixtures, for the developer gallery: three bank accounts, bills with
 * something owing on four matters, a service that answers without a server, and the states the
 * screen is reviewed in. Example data, not real matters.
 */
import type { BillingDepositDetail } from "@magna-carta/api-client";
import type { DepositAccount, DepositForm, OpenBill } from "./deposit-form.svelte.ts";
import type { DepositService } from "./deposit-service.ts";

export const RECORD_PAYMENT_GALLERY_STATES = [
  "blank",
  "filled",
  "cash",
  "refused",
  "deposit",
] as const;
export type RecordPaymentGalleryState = (typeof RECORD_PAYMENT_GALLERY_STATES)[number];

export const GALLERY_TODAY = "2026-11-20";

export const GALLERY_ACCOUNTS: readonly DepositAccount[] = [
  {
    ledgerAccountId: "acct-main",
    name: "Main Operating",
    bankName: "Wells Fargo",
    lastFour: "4417",
    logo: null,
    isDefault: true,
  },
  {
    ledgerAccountId: "acct-payroll",
    name: "Payroll",
    bankName: "First Example Bank",
    lastFour: "0921",
    logo: null,
    isDefault: false,
  },
  {
    ledgerAccountId: "acct-reserve",
    name: "Tax Reserve",
    bankName: "Cascade Credit Union",
    lastFour: "7730",
    logo: null,
    isDefault: false,
  },
];

const bill = (
  invoiceId: string,
  invoiceNumber: string,
  matterId: string,
  matterNumber: string,
  matterTitle: string,
  clientName: string,
  owedMinor: number,
  issueDate = "2026-10-31",
): OpenBill => ({
  invoiceId,
  invoiceNumber,
  issueDate,
  matterId,
  matterNumber,
  matterTitle,
  clientName,
  currency: "USD",
  owedMinor,
});

export const GALLERY_BILLS: readonly OpenBill[] = [
  bill(
    "inv-413",
    "00413",
    "mat-113",
    "2024-0113",
    "Acme Holdings v. Brant",
    "Acme Holdings LLC",
    382500,
  ),
  bill(
    "inv-401",
    "00401",
    "mat-113",
    "2024-0113",
    "Acme Holdings v. Brant",
    "Acme Holdings LLC",
    91000,
    "2026-09-30",
  ),
  bill("inv-420", "00420", "mat-041", "2025-0041", "Ruiz Estate Plan", "Dana Ruiz", 120000),
  bill("inv-398", "00398", "mat-007", "2026-0007", "Kline Lease Review", "Morgan Kline", 65000),
  bill(
    "inv-417",
    "00417",
    "mat-022",
    "2026-0022",
    "Whitcombe Contract Dispute",
    "Eleanor Whitcombe",
    1250000,
  ),
];

/** A scan of a check, drawn in the browser so the gallery has an image to show. */
async function checkScan(number: string, amount: string, payer: string): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 380;
  const context = canvas.getContext("2d");
  if (context !== null) {
    const style = getComputedStyle(document.documentElement);
    const paper = style.getPropertyValue("--mc-surface-sunken").trim() || "white";
    const ink = style.getPropertyValue("--mc-text-default").trim() || "black";
    context.fillStyle = paper;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = ink;
    context.lineWidth = 3;
    context.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
    context.fillStyle = ink;
    context.font = "28px sans-serif";
    context.fillText(payer, 48, 72);
    context.fillText(`No. ${number}`, 700, 72);
    context.fillText("Pay to the order of  Example Law Group", 48, 170);
    context.fillText(`$ ${amount}`, 680, 170);
    context.fillText("Memo  Bill 00413", 48, 300);
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return new File([blob ?? new Blob()], `check-${number}-front.png`, { type: "image/png" });
}

export function gallerySeed(
  state: RecordPaymentGalleryState,
): ((form: DepositForm) => void) | undefined {
  if (state === "blank") return undefined;
  return (form) => {
    form.depositedOn = GALLERY_TODAY;
    const first = form.lines[0];
    if (first === undefined) return;
    if (state === "refused") {
      form.pickMatter(first, "mat-041");
      form.pickMethod(first, "money_order");
      first.amountText = "1,500.00";
      first.receivedFrom = "";
      form.attempted = true;
      return;
    }
    if (state === "cash") {
      form.pickMatter(first, "mat-041");
      form.pickMethod(first, "cash");
      first.reference = "R-2207";
      first.receivedFrom = "Dana Ruiz";
      first.receivedOn = "2026-11-19";
      first.details = { receivedBy: "Pat Lee", countedBy: "Sam Ortiz" };
      first.shownDetails = ["countedBy"];
      first.cashCount = { bill10000: "8", bill5000: "3", bill2000: "2", bill1000: "1" };
      first.expanded = true;
      return;
    }
    form.slipNumber = "DS-1182";
    form.pickMatter(first, "mat-113");
    form.pickBill(first, "inv-413");
    first.reference = "1043";
    first.receivedOn = "2026-11-18";
    first.amountText = "1,500.00";
    first.memo = "Bill 00413";
    first.details = { checkDate: "2026-11-17", bank: "Wells Fargo", account: "6621" };
    first.shownDetails = ["checkDate", "bank", "account"];
    first.expanded = true;

    const second = form.duplicateLine(first.key);
    if (second !== null) {
      second.reference = "1044";
      second.amountText = "1,325.00";
      second.expanded = false;
      second.note = "Second check for the same bill.";
    }
    const third = form.addLine();
    if (third !== null) {
      form.pickMatter(third, "mat-041");
      form.pickMethod(third, "cash");
      third.reference = "R-2207";
      third.receivedOn = "2026-11-19";
      third.amountText = "1,000.00";
      third.details = { receivedBy: "Pat Lee" };
    }
    const fourth = form.addLine();
    if (fourth !== null) {
      form.pickMatter(fourth, "mat-007");
      form.pickMethod(fourth, "money_order");
      fourth.reference = "24871193055";
      fourth.receivedOn = "2026-11-19";
      fourth.details = { issuer: "USPS" };
      fourth.memo = "Lease review";
    }
    const fee = form.addFee();
    if (fee !== null) {
      fee.description = "Deposit item fee";
      fee.amountText = "15.00";
    }
    void Promise.all([
      checkScan("1043", "1,500.00", "Acme Holdings LLC"),
      checkScan("1044", "1,325.00", "Acme Holdings LLC"),
      checkScan("24871193055", "650.00", "Morgan Kline"),
    ]).then(([one, two, four]) => {
      first.files = [{ key: "scan-1043", file: one, kind: "scan" }];
      if (second !== null) second.files = [{ key: "scan-1044", file: two, kind: "scan" }];
      if (fourth !== null) fourth.files = [{ key: "scan-mo", file: four, kind: "scan" }];
    });
  };
}

export const galleryDepositService: DepositService = {
  record: async (request) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return {
      kind: "ok",
      value: {
        depositId: "deposit-gallery",
        receiptIds: request.lines.map((_, index) => `receipt-${index}`),
      },
    };
  },
  attachFile: async () => ({ kind: "ok", value: { id: crypto.randomUUID() } }),
  addNote: async () => ({ kind: "ok", value: { id: crypto.randomUUID() } }),
};

/** A recorded deposit as its own page reads it back. */
export const GALLERY_DEPOSIT: BillingDepositDetail = {
  id: "deposit-gallery",
  depositToAccountId: "acct-main",
  depositToName: "Main Operating",
  depositedOn: GALLERY_TODAY,
  slipNumber: "DS-1182",
  currency: "USD",
  paymentsMinor: 447500,
  feesMinor: 1500,
  depositMinor: 446000,
  recordedBy: null,
  recordedAt: "2026-11-20T17:42:00Z",
  lines: [
    {
      receiptId: "receipt-0",
      lineNumber: 1,
      invoiceId: "inv-413",
      invoiceNumber: "00413",
      matterId: "mat-113",
      matterNumber: "2024-0113",
      matterTitle: "Acme Holdings v. Brant",
      method: "check",
      reference: "1043",
      receivedFrom: "Acme Holdings LLC",
      receivedOn: "2026-11-18",
      amountMinor: 150000,
      memo: "Bill 00413",
      details: { checkDate: "2026-11-17", bank: "Wells Fargo", account: "6621" },
      reversed: false,
    },
    {
      receiptId: "receipt-1",
      lineNumber: 2,
      invoiceId: "inv-413",
      invoiceNumber: "00413",
      matterId: "mat-113",
      matterNumber: "2024-0113",
      matterTitle: "Acme Holdings v. Brant",
      method: "check",
      reference: "1044",
      receivedFrom: "Acme Holdings LLC",
      receivedOn: "2026-11-18",
      amountMinor: 132500,
      memo: null,
      details: {},
      reversed: true,
    },
    {
      receiptId: "receipt-2",
      lineNumber: 3,
      invoiceId: "inv-420",
      invoiceNumber: "00420",
      matterId: "mat-041",
      matterNumber: "2025-0041",
      matterTitle: "Ruiz Estate Plan",
      method: "cash",
      reference: "R-2207",
      receivedFrom: "Dana Ruiz",
      receivedOn: "2026-11-19",
      amountMinor: 100000,
      memo: null,
      details: { receivedBy: "Pat Lee", cashCount: { bill10000: 10 } },
      reversed: false,
    },
    {
      receiptId: "receipt-3",
      lineNumber: 4,
      invoiceId: "inv-398",
      invoiceNumber: "00398",
      matterId: "mat-007",
      matterNumber: "2026-0007",
      matterTitle: "Kline Lease Review",
      method: "money_order",
      reference: "24871193055",
      receivedFrom: "Morgan Kline",
      receivedOn: "2026-11-19",
      amountMinor: 65000,
      memo: "Lease review",
      details: { issuer: "USPS" },
      reversed: false,
    },
  ],
  fees: [{ lineNumber: 1, description: "Deposit item fee", amountMinor: 1500 }],
  notes: [
    {
      id: "note-1",
      receiptId: "receipt-1",
      body: "Second check for the same bill. Returned by the bank on 11/21; reversed from the bill.",
      writtenBy: null,
      writtenAt: "2026-11-21T15:10:00Z",
    },
  ],
  files: [],
};
