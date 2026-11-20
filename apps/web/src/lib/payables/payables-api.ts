/*
 * The operating books' writes, through the generated client: the chart, the firm's own bank
 * accounts, vendor bills and paying them. The two screens read the chart and the board through the
 * generated query options and the shared cache; what is here is every write, each answering with
 * the three-outcome `ApiOutcome` every failure surface renders from, never a throw.
 */
import {
  ledgerAdoptStandardChart,
  ledgerCreateAccount,
  ledgerOpenOperatingAccount,
  ledgerSetAccountRoles,
  ledgerSetDefaultOperatingAccount,
  payablesPayBills,
  payablesRecordBill,
  payablesReverseBill,
  payablesSetVendorDefaultAccount,
  payablesVendorDefaultAccount,
  type LedgerCreateAccountRequest,
  type LedgerRoleAssignmentsRequest,
  type OpenOperatingBankAccountRequest,
  type PayVendorBillsRequest,
  type RecordVendorBillRequest,
} from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";

export type {
  LedgerChartAccount,
  LedgerChartResponse,
  OperatingBankAccount,
  VendorBillBoard,
  VendorBillSummary,
} from "@magna-carta/api-client";

/** The permissions the two screens check before offering a write. */
export const BOOKS_PERMISSIONS = {
  read: "billing:read",
  configure: "billing:configure",
  payables: "payables:manage",
} as const;

async function attempt<T>(call: () => Promise<{ data: T }>): Promise<ApiOutcome<T>> {
  try {
    const { data } = await call();
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

const keyed = (idempotencyKey: string) => ({ "idempotency-key": idempotencyKey });

export const recordVendorBill = (body: RecordVendorBillRequest, key: string) =>
  attempt(() => payablesRecordBill({ body, headers: keyed(key), throwOnError: true }));

export const payVendorBills = (body: PayVendorBillsRequest, key: string) =>
  attempt(() => payablesPayBills({ body, headers: keyed(key), throwOnError: true }));

export const reverseVendorBill = (
  vendorBillId: string,
  body: { reason: string; reversedOn: string },
  key: string,
) =>
  attempt(() =>
    payablesReverseBill({ path: { vendorBillId }, body, headers: keyed(key), throwOnError: true }),
  );

export const readVendorDefaultAccount = (vendorId: string) =>
  attempt(() => payablesVendorDefaultAccount({ path: { vendorId }, throwOnError: true }));

export const setVendorDefaultAccount = (vendorId: string, ledgerAccountId: string | null, key: string) =>
  attempt(() =>
    payablesSetVendorDefaultAccount({
      path: { vendorId },
      body: { ledgerAccountId },
      headers: keyed(key),
      throwOnError: true,
    }),
  );

export const adoptStandardChart = (key: string) =>
  attempt(() => ledgerAdoptStandardChart({ headers: keyed(key), throwOnError: true }));

export const createLedgerAccount = (body: LedgerCreateAccountRequest, key: string) =>
  attempt(() => ledgerCreateAccount({ body, headers: keyed(key), throwOnError: true }));

export const setAccountRoles = (body: LedgerRoleAssignmentsRequest, key: string) =>
  attempt(() => ledgerSetAccountRoles({ body, headers: keyed(key), throwOnError: true }));

export const openOperatingAccount = (body: OpenOperatingBankAccountRequest, key: string) =>
  attempt(() => ledgerOpenOperatingAccount({ body, headers: keyed(key), throwOnError: true }));

export const setDefaultOperatingAccount = (operatingBankAccountId: string, key: string) =>
  attempt(() =>
    ledgerSetDefaultOperatingAccount({
      path: { operatingBankAccountId },
      headers: keyed(key),
      throwOnError: true,
    }),
  );
