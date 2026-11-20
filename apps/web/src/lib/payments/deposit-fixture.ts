/*
 * The shape a deposit's page holds while it is read: two lines in the sample vocabulary, drawn by
 * the real view under the loading region, so the page keeps its layout as the answer arrives.
 */
import type { BillingDepositDetail } from "@magna-carta/api-client";
import {
  sampleCivilDate,
  sampleInstant,
  sampleMatter,
  samplePerson,
} from "@magna-carta/design-system/loading-fixtures";

export function depositFixture(): BillingDepositDetail {
  const lines = [0, 1].map((index) => {
    const matter = sampleMatter(index);
    return {
      receiptId: `fixture-${index}`,
      lineNumber: index + 1,
      invoiceId: `fixture-bill-${index}`,
      invoiceNumber: matter.number,
      matterId: `fixture-matter-${index}`,
      matterNumber: matter.number,
      matterTitle: matter.title,
      method: "check" as const,
      reference: matter.number,
      receivedFrom: samplePerson(index).name,
      receivedOn: sampleCivilDate(index),
      amountMinor: 125000,
      memo: null,
      details: {},
      reversed: false,
    };
  });
  return {
    id: "fixture",
    depositToAccountId: "fixture-account",
    depositToName: sampleMatter(2).client,
    depositedOn: sampleCivilDate(0),
    slipNumber: null,
    currency: "USD",
    paymentsMinor: 250000,
    feesMinor: 0,
    depositMinor: 250000,
    recordedBy: null,
    recordedAt: sampleInstant(0),
    lines,
    fees: [],
    notes: [],
    files: [],
  };
}
