import { isCivilDate } from "@magna-carta/civil-time/civil-date";
import { BillingValidationError } from "./billing-validation.ts";
import { aggregateMinor, countedMinor } from "./line-amounts.ts";

// HOW A PAYMENT RECORDED BY HAND ARRIVED, and the details each way of paying carries. The method list
// is closed (the payment_receipt CHECK holds the same list); the details are a JSON object on the
// receipt, checked here field by field, so a check carries its bank and the date written on it, a card
// its brand and last four, and cash how it was counted. Only the last four digits of an account or
// card number are ever kept, and a routing number is the bank's public number, not the client's.

export const PAYMENT_METHODS = [
  "check",
  "cashiers_check",
  "money_order",
  "cash",
  "ach",
  "wire",
  "card",
  "payment_app",
  "other",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** The methods recorded without a reference number. Every other one needs its number. */
export const METHODS_WITHOUT_REFERENCE: ReadonlySet<PaymentMethod> = new Set(["cash", "other"]);

type FieldKind =
  | { readonly kind: "text" }
  | { readonly kind: "date" }
  | { readonly kind: "lastFour" }
  | { readonly kind: "routing" }
  | { readonly kind: "choice"; readonly choices: readonly string[] };

interface FieldRule {
  readonly label: string;
  readonly required: boolean;
  readonly shape: FieldKind;
}

const text = (label: string, required = false): FieldRule => ({
  label,
  required,
  shape: { kind: "text" },
});
const date = (label: string): FieldRule => ({ label, required: false, shape: { kind: "date" } });
const lastFour = (label: string, required = false): FieldRule => ({
  label,
  required,
  shape: { kind: "lastFour" },
});
const choice = (label: string, choices: readonly string[], required = false): FieldRule => ({
  label,
  required,
  shape: { kind: "choice", choices },
});

export const MONEY_ORDER_ISSUERS = ["USPS", "Western Union", "MoneyGram", "A bank", "Other"];
export const CARD_BRANDS = ["Visa", "Mastercard", "American Express", "Discover", "Other"];
export const CARD_ENTRY = ["Chip", "Tap", "Swipe", "Typed in"];
export const PAYMENT_APPS = ["Zelle", "Venmo", "PayPal", "Cash App", "Other"];

export const METHOD_DETAILS: Readonly<Record<PaymentMethod, Readonly<Record<string, FieldRule>>>> =
  {
    check: {
      checkDate: date("Date on Check"),
      nameOnCheck: text("Name on Check"),
      bank: text("Bank"),
      routing: { label: "Routing Number", required: false, shape: { kind: "routing" } },
      account: lastFour("Account Ending In"),
    },
    cashiers_check: {
      bank: text("Issuing Bank", true),
      purchaser: text("Purchased By"),
      issueDate: date("Issue Date"),
    },
    money_order: {
      issuer: choice("Issuer", MONEY_ORDER_ISSUERS, true),
      purchaser: text("Purchased By"),
      issueDate: date("Issue Date"),
    },
    cash: {
      receivedBy: text("Received By", true),
      countedBy: text("Counted By"),
      receiptGiven: choice("Receipt Given", ["Yes", "No"]),
    },
    ach: {
      bank: text("Sending Bank"),
      account: lastFour("Account Ending In"),
      sent: date("Date Sent"),
      description: text("Description on Statement"),
    },
    wire: {
      scope: choice("Domestic or International", ["Domestic", "International"], true),
      bank: text("Sending Bank"),
      account: lastFour("Account Ending In"),
      bankReference: text("Bank Reference"),
      swift: text("SWIFT / BIC"),
    },
    card: {
      brand: choice("Card Brand", CARD_BRANDS, true),
      lastFour: lastFour("Card Ending In", true),
      transaction: text("Transaction ID"),
      entry: choice("How It Was Taken", CARD_ENTRY),
      terminal: text("Terminal"),
    },
    payment_app: {
      service: choice("Service", PAYMENT_APPS, true),
      sender: text("Sent From"),
    },
    other: {
      describe: text("How It Was Paid", true),
    },
  };

// Cash counted by bill and coin: each key is a denomination, each value how many. The dollar coin is
// its own key so a count of dollar bills and dollar coins reads back as the person counted it.
export const CASH_DENOMINATIONS: Readonly<Record<string, number>> = {
  bill10000: 10000,
  bill5000: 5000,
  bill2000: 2000,
  bill1000: 1000,
  bill500: 500,
  bill200: 200,
  bill100: 100,
  coin100: 100,
  coin50: 50,
  coin25: 25,
  coin10: 10,
  coin5: 5,
  coin1: 1,
};

const MAX_TEXT = 200;

export type PaymentDetails = Readonly<Record<string, string | Readonly<Record<string, number>>>>;

function refuse(line: number, message: string): never {
  throw new BillingValidationError("payment-receipt-invalid", `line ${line}: ${message}`);
}

/**
 * The details of one line, checked against its method and returned with blank values dropped.
 * `cashCount`, on cash only, must add up to the line's amount.
 */
export function checkPaymentDetails(
  line: number,
  method: PaymentMethod,
  amountMinor: number,
  details: Readonly<Record<string, unknown>>,
): PaymentDetails {
  const rules = METHOD_DETAILS[method];
  const kept: Record<string, string | Readonly<Record<string, number>>> = {};
  for (const [key, raw] of Object.entries(details)) {
    if (key === "cashCount") continue;
    const rule = rules[key];
    if (!rule) refuse(line, `${key} is not a detail of a ${method.replace("_", " ")} payment`);
    if (raw === null || raw === undefined) continue;
    if (typeof raw !== "string") refuse(line, `${rule.label} must be text`);
    const value = raw.trim();
    if (value === "") continue;
    if (value.length > MAX_TEXT)
      refuse(line, `${rule.label} is longer than ${MAX_TEXT} characters`);
    switch (rule.shape.kind) {
      case "date":
        if (!isCivilDate(value)) refuse(line, `${rule.label} must be a date (YYYY-MM-DD)`);
        break;
      case "lastFour":
        if (!/^\d{4}$/.test(value)) refuse(line, `${rule.label} must be exactly 4 digits`);
        break;
      case "routing":
        if (!/^\d{9}$/.test(value)) refuse(line, `${rule.label} must be 9 digits`);
        break;
      case "choice":
        if (!rule.shape.choices.includes(value)) {
          refuse(line, `${rule.label} must be one of ${rule.shape.choices.join(", ")}`);
        }
        break;
      case "text":
        break;
    }
    kept[key] = value;
  }
  for (const [key, rule] of Object.entries(rules)) {
    if (rule.required && kept[key] === undefined) refuse(line, `${rule.label} is required`);
  }

  const count = details["cashCount"];
  if (count !== undefined && count !== null) {
    if (method !== "cash") refuse(line, "only cash is counted by bill and coin");
    if (typeof count !== "object" || Array.isArray(count)) {
      refuse(line, "the cash count must be a count per bill and coin");
    }
    let totalMinor = 0;
    const counted: Record<string, number> = {};
    for (const [denomination, pieces] of Object.entries(count as Record<string, unknown>)) {
      const value = CASH_DENOMINATIONS[denomination];
      if (value === undefined) refuse(line, `${denomination} is not a bill or coin`);
      if (typeof pieces !== "number" || !Number.isInteger(pieces) || pieces < 0) {
        refuse(line, `the count of ${denomination} must be a whole number`);
      }
      if (pieces === 0) continue;
      counted[denomination] = pieces;
      // The denominations are United States bills and coins, so the count is in dollars.
      totalMinor = aggregateMinor([totalMinor, countedMinor(value, pieces, "USD")], "USD");
    }
    if (Object.keys(counted).length > 0) {
      if (totalMinor !== amountMinor) {
        refuse(
          line,
          `the bills and coins counted add up to ${totalMinor} and the line is ${amountMinor}`,
        );
      }
      kept["cashCount"] = counted;
    }
  }
  return kept;
}
