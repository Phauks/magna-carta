/*
 * The words and sums the Vendor Bills screen shows, kept apart from the screen so they are tested
 * without one. Money arrives in minor units and leaves as dollars with thousands commas.
 */
import { formatMoney } from "@magna-carta/design-system/data-table";
import type { VendorBillBoard, VendorBillSummary } from "@magna-carta/api-client";

export type VendorBillGroup = VendorBillBoard["vendors"][number];
export type AgingBucket = keyof VendorBillGroup["aging"];

export const money = (amountMinor: number): string =>
  formatMoney(amountMinor / 100, { currency: "USD" });

/** The aging chip's words, oldest first so the worst is read first. */
export const AGING_ORDER: readonly AgingBucket[] = [
  "over90",
  "days61To90",
  "days31To60",
  "days1To30",
  "current",
];

export function agingLabel(bucket: AgingBucket): string {
  switch (bucket) {
    case "current":
      return "Current";
    case "days1To30":
      return "1-30 days";
    case "days31To60":
      return "31-60 days";
    case "days61To90":
      return "61-90 days";
    case "over90":
      return "Over 90 days";
  }
}

/** A vendor's chips: each bucket holding money, oldest first. */
export function agingChips(
  group: VendorBillGroup,
): Array<{ bucket: AgingBucket; label: string; overdue: boolean }> {
  return AGING_ORDER.filter((bucket) => group.aging[bucket] > 0).map((bucket) => ({
    bucket,
    label: `${agingLabel(bucket)} ${money(group.aging[bucket])}`,
    overdue: bucket !== "current",
  }));
}

export function billCountText(count: number): string {
  return count === 1 ? "1 bill" : `${count} bills`;
}

export function vendorText(group: Pick<VendorBillGroup, "vendorName">): string {
  return group.vendorName ?? "Unnamed vendor";
}

export function stateLabel(bill: VendorBillSummary): string {
  switch (bill.state) {
    case "unpaid":
      return "Unpaid";
    case "partPaid":
      return "Paid in part";
    case "paid":
      return "Paid";
    case "reversed":
      return "Reversed";
  }
}

/** Whether a bill is past its due date (or its bill date, with no due date) and still open. */
export function isOverdue(bill: VendorBillSummary, today: string): boolean {
  return bill.openMinor > 0 && (bill.dueDate ?? bill.billDate) < today;
}

/** A bill can be ticked to pay only while something is left to pay on it. */
export const isPayable = (bill: VendorBillSummary): boolean => bill.openMinor > 0;

/** The total the ticked bills leave to pay, and how many vendors they cover. */
export function selectionSummary(
  vendors: readonly VendorBillGroup[],
  selected: ReadonlySet<string>,
): { count: number; vendorCount: number; openMinor: number } {
  let count = 0;
  let openMinor = 0;
  let vendorCount = 0;
  for (const vendor of vendors) {
    const picked = vendor.bills.filter((bill) => selected.has(bill.vendorBillId) && isPayable(bill));
    if (picked.length > 0) vendorCount += 1;
    count += picked.length;
    openMinor += picked.reduce((total, bill) => total + bill.openMinor, 0);
  }
  return { count, vendorCount, openMinor };
}

/** Whether every payable bill of a vendor is ticked, some are, or none are. */
export function vendorTickState(
  vendor: VendorBillGroup,
  selected: ReadonlySet<string>,
): "all" | "some" | "none" {
  const payable = vendor.bills.filter(isPayable);
  const ticked = payable.filter((bill) => selected.has(bill.vendorBillId)).length;
  if (payable.length === 0 || ticked === 0) return "none";
  return ticked === payable.length ? "all" : "some";
}

/** Dollars typed by a person, as minor units: the same reading the cost window uses. */
export { parseAmountMinor } from "$lib/costs/cost-operations.ts";
