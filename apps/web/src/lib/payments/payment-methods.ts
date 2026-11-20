/*
 * How a payment recorded by hand arrived, as the Record a Payment screen offers it: each method's
 * name, what its reference number is called, and the details it carries.
 *
 * THE SERVER IS THE AUTHORITY. `packages/billing/src/payment-methods.ts` holds the same list and
 * checks every detail field by field; this copy exists so the screen can draw the right fields and
 * mark the required ones before anything is sent. The keys, the choices and which fields are
 * required must match that file exactly, or the server refuses a line the screen let through.
 */
import type { BillingRecordDepositRequest } from "@magna-carta/api-client";
import { isCivilDate } from "@magna-carta/civil-time/civil-date";

export type PaymentMethod = BillingRecordDepositRequest["lines"][number]["method"];

export type DetailShape =
  | { readonly kind: "text" }
  | { readonly kind: "date" }
  | { readonly kind: "lastFour" }
  | { readonly kind: "routing" }
  | { readonly kind: "choice"; readonly choices: readonly string[] };

export interface DetailField {
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  readonly shape: DetailShape;
}

export interface MethodEntry {
  readonly method: PaymentMethod;
  readonly label: string;
  /** What this method's reference number is called on the line. */
  readonly reference: string;
  /** Cash and Other may be recorded without one; every other method needs its number. */
  readonly referenceRequired: boolean;
  readonly details: readonly DetailField[];
}

const text = (key: string, label: string, required = false): DetailField => ({
  key,
  label,
  required,
  shape: { kind: "text" },
});
const date = (key: string, label: string): DetailField => ({
  key,
  label,
  required: false,
  shape: { kind: "date" },
});
const lastFour = (key: string, label: string, required = false): DetailField => ({
  key,
  label,
  required,
  shape: { kind: "lastFour" },
});
const choice = (
  key: string,
  label: string,
  choices: readonly string[],
  required = false,
): DetailField => ({ key, label, required, shape: { kind: "choice", choices } });

export const PAYMENT_METHOD_ENTRIES: readonly MethodEntry[] = [
  {
    method: "check",
    label: "Check",
    reference: "Check No.",
    referenceRequired: true,
    details: [
      date("checkDate", "Date on Check"),
      text("nameOnCheck", "Name on Check"),
      text("bank", "Bank"),
      { key: "routing", label: "Routing Number", required: false, shape: { kind: "routing" } },
      lastFour("account", "Account Ending In"),
    ],
  },
  {
    method: "cashiers_check",
    label: "Cashier's Check",
    reference: "Check No.",
    referenceRequired: true,
    details: [
      text("bank", "Issuing Bank", true),
      text("purchaser", "Purchased By"),
      date("issueDate", "Issue Date"),
    ],
  },
  {
    method: "money_order",
    label: "Money Order",
    reference: "Serial No.",
    referenceRequired: true,
    details: [
      choice("issuer", "Issuer", ["USPS", "Western Union", "MoneyGram", "A bank", "Other"], true),
      text("purchaser", "Purchased By"),
      date("issueDate", "Issue Date"),
    ],
  },
  {
    method: "cash",
    label: "Cash",
    reference: "Receipt No.",
    referenceRequired: false,
    details: [
      text("receivedBy", "Received By", true),
      text("countedBy", "Counted By"),
      choice("receiptGiven", "Receipt Given", ["Yes", "No"]),
    ],
  },
  {
    method: "ach",
    label: "ACH Transfer",
    reference: "Trace No.",
    referenceRequired: true,
    details: [
      text("bank", "Sending Bank"),
      lastFour("account", "Account Ending In"),
      date("sent", "Date Sent"),
      text("description", "Description on Statement"),
    ],
  },
  {
    method: "wire",
    label: "Wire Transfer",
    reference: "Fed Reference",
    referenceRequired: true,
    details: [
      choice("scope", "Domestic or International", ["Domestic", "International"], true),
      text("bank", "Sending Bank"),
      lastFour("account", "Account Ending In"),
      text("bankReference", "Bank Reference"),
      text("swift", "SWIFT / BIC"),
    ],
  },
  {
    method: "card",
    label: "Card",
    reference: "Approval Code",
    referenceRequired: true,
    details: [
      choice(
        "brand",
        "Card Brand",
        ["Visa", "Mastercard", "American Express", "Discover", "Other"],
        true,
      ),
      lastFour("lastFour", "Card Ending In", true),
      text("transaction", "Transaction ID"),
      choice("entry", "How It Was Taken", ["Chip", "Tap", "Swipe", "Typed in"]),
      text("terminal", "Terminal"),
    ],
  },
  {
    method: "payment_app",
    label: "Payment App",
    reference: "Transaction ID",
    referenceRequired: true,
    details: [
      choice("service", "Service", ["Zelle", "Venmo", "PayPal", "Cash App", "Other"], true),
      text("sender", "Sent From"),
    ],
  },
  {
    method: "other",
    label: "Other",
    reference: "Ref No.",
    referenceRequired: false,
    details: [text("describe", "How It Was Paid", true)],
  },
];

const BY_METHOD = new Map(PAYMENT_METHOD_ENTRIES.map((entry) => [entry.method, entry]));

export function methodEntry(method: PaymentMethod): MethodEntry {
  const entry = BY_METHOD.get(method);
  if (entry === undefined) throw new Error(`Unknown payment method ${method}`);
  return entry;
}

export function methodLabel(method: PaymentMethod): string {
  return methodEntry(method).label;
}

/** Cash counted by bill and coin. The keys are the server's; the dollar coin has its own. */
export interface Denomination {
  readonly key: string;
  readonly label: string;
  readonly valueMinor: number;
}

export const CASH_BILLS: readonly Denomination[] = [
  { key: "bill10000", label: "$100", valueMinor: 10000 },
  { key: "bill5000", label: "$50", valueMinor: 5000 },
  { key: "bill2000", label: "$20", valueMinor: 2000 },
  { key: "bill1000", label: "$10", valueMinor: 1000 },
  { key: "bill500", label: "$5", valueMinor: 500 },
  { key: "bill200", label: "$2", valueMinor: 200 },
  { key: "bill100", label: "$1", valueMinor: 100 },
];

export const CASH_COINS: readonly Denomination[] = [
  { key: "coin100", label: "$1 coin", valueMinor: 100 },
  { key: "coin50", label: "50¢", valueMinor: 50 },
  { key: "coin25", label: "25¢", valueMinor: 25 },
  { key: "coin10", label: "10¢", valueMinor: 10 },
  { key: "coin5", label: "5¢", valueMinor: 5 },
  { key: "coin1", label: "1¢", valueMinor: 1 },
];

/** Why a typed detail would be refused, or null when it is fine (blank is fine unless required). */
export function detailRefusal(field: DetailField, value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return field.required ? `${field.label} is required.` : null;
  if (trimmed.length > 200) return `${field.label} is longer than 200 characters.`;
  switch (field.shape.kind) {
    case "date":
      return isCivilDate(trimmed) ? null : `${field.label} must be a date.`;
    case "lastFour":
      return /^\d{4}$/.test(trimmed) ? null : `${field.label} must be exactly 4 digits.`;
    case "routing":
      return /^\d{9}$/.test(trimmed) ? null : `${field.label} must be 9 digits.`;
    case "choice":
      return field.shape.choices.includes(trimmed)
        ? null
        : `${field.label} must be one of ${field.shape.choices.join(", ")}.`;
    case "text":
      return null;
  }
}
