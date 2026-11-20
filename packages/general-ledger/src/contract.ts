import { z } from "zod";
import { ACCOUNT_ROLES } from "@magna-carta/account-roles/account-roles";
import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { identifierField } from "@magna-carta/identifiers/field";
import { ACCOUNT_TYPES } from "@magna-carta/ledger/types";
import { ALL_STATEMENT_SECTIONS, type StatementSection } from "./sections.ts";
import { VENDOR_BILL_PAYMENT_METHODS } from "./vendor-bills.ts";

// The operating books' contract: what the chart, bank account and vendor bill routes accept and
// return, as plain zod. Each component is named with zod's own metadata (`.meta({ id })`), which
// the contract emitter reads as the component's name. Path and query parameters stay with the
// routes in apps/api-worker.

export const civilDateField = z.string().regex(CIVIL_DATE_PATTERN);
export const vendorIdField = z.string().min(1).max(128);
const civilDate = civilDateField;
const vendorId = vendorIdField;
const ledgerAccountId = identifierField("ledgerAccount");
const operatingBankAccountId = identifierField("operatingBankAccount");
const vendorBillId = identifierField("vendorBill");
const paymentMethod = z.enum(
  VENDOR_BILL_PAYMENT_METHODS as unknown as ["check", "bank_transfer", "card", "cash"],
);

export const CreatedResponse = z.object({ id: z.string() }).meta({ id: "LedgerCreatedResponse" });
export const CountResponse = z
  .object({ count: z.number().int() })
  .meta({ id: "LedgerCountResponse" });
export const PaymentsResponse = z
  .object({ paymentIds: z.array(z.string()) })
  .meta({ id: "VendorBillPaymentsResponse" });
export const RoleAssignmentsRequest = z
  .object({
    assignments: z
      .array(z.object({ role: z.enum(ACCOUNT_ROLES), ledgerAccountId }))
      .min(1)
      .max(20),
  })
  .meta({ id: "LedgerRoleAssignmentsRequest" });
export const VendorDefaultAccountResponse = z
  .object({ ledgerAccountId: z.string().nullable() })
  .meta({ id: "VendorDefaultAccountResponse" });
export const SetVendorDefaultAccountRequest = z
  .object({ ledgerAccountId: ledgerAccountId.nullable() })
  .meta({ id: "SetVendorDefaultAccountRequest" });

export const ChartAccount = z
  .object({
    ledgerAccountId: z.string(),
    code: z.string().nullable(),
    name: z.string(),
    type: z.enum(ACCOUNT_TYPES),
    statementSection: z.string().nullable(),
    description: z.string().nullable(),
    systemAccount: z.boolean(),
    active: z.boolean(),
    parentAccountId: z.string().nullable(),
    hasChildren: z.boolean(),
    balanceMinor: z.number().int(),
    trustRegistration: z
      .enum(["bank", "liabilityRoot", "client", "matter", "firmFunds"])
      .nullable(),
    operatingBankAccountId: z.string().nullable(),
    roles: z.array(z.enum(ACCOUNT_ROLES)),
  })
  .meta({ id: "LedgerChartAccount" });

export const OperatingAccount = z
  .object({
    operatingBankAccountId: z.string(),
    name: z.string(),
    bankName: z.string().nullable(),
    accountNumberLastFour: z.string().nullable(),
    ledgerAccountId: z.string(),
    code: z.string().nullable(),
    openedOn: z.string(),
    closedAt: z.string().nullable(),
    balanceMinor: z.number().int(),
    isDefault: z.boolean(),
  })
  .meta({ id: "OperatingBankAccount" });

export const RoleAssignment = z.object({ role: z.enum(ACCOUNT_ROLES), ledgerAccountId });

export const ChartResponse = z
  .object({
    accounts: z.array(ChartAccount),
    operatingAccounts: z.array(OperatingAccount),
    roles: z.array(z.object({ role: z.enum(ACCOUNT_ROLES), ledgerAccountId: z.string() })),
    suggestedRoles: z.array(z.object({ role: z.enum(ACCOUNT_ROLES), ledgerAccountId: z.string() })),
    hasStandardChart: z.boolean(),
  })
  .meta({ id: "LedgerChartResponse" });

const sectionField = z.enum(
  ALL_STATEMENT_SECTIONS as unknown as [StatementSection, ...StatementSection[]],
);

export const CreateAccountRequest = z
  .object({
    name: z.string().min(1).max(200),
    type: z.enum(ACCOUNT_TYPES),
    code: z.string().max(20).nullable().optional(),
    statementSection: sectionField.nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    parentAccountId: ledgerAccountId.optional(),
  })
  .meta({ id: "LedgerCreateAccountRequest" });

export const UpdateAccountRequest = z
  .object({
    name: z.string().min(1).max(200).optional(),
    code: z.string().max(20).nullable().optional(),
    statementSection: sectionField.nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
  })
  .meta({ id: "LedgerUpdateAccountRequest" });

export const OpenOperatingAccountRequest = z
  .object({
    name: z.string().min(1).max(200),
    bankName: z.string().max(200).nullable().optional(),
    accountNumberLastFour: z.string().max(4).nullable().optional(),
    code: z.string().max(20).nullable().optional(),
    openedOn: civilDate,
    makeDefault: z.boolean().optional(),
  })
  .meta({ id: "OpenOperatingBankAccountRequest" });

export const EditOperatingAccountRequest = z
  .object({
    name: z.string().min(1).max(200).optional(),
    bankName: z.string().max(200).nullable().optional(),
    accountNumberLastFour: z.string().max(4).nullable().optional(),
  })
  .meta({ id: "EditOperatingBankAccountRequest" });

export const AgingAmounts = z.object({
  current: z.number().int(),
  days1To30: z.number().int(),
  days31To60: z.number().int(),
  days61To90: z.number().int(),
  over90: z.number().int(),
});

export const BillState = z.enum(["unpaid", "partPaid", "paid", "reversed"]);
export const AgingBucket = z.enum(["current", "days1To30", "days31To60", "days61To90", "over90"]);

export const BillSummary = z
  .object({
    vendorBillId: z.string(),
    vendorId: z.string(),
    billReference: z.string().nullable(),
    billDate: z.string(),
    dueDate: z.string().nullable(),
    amountMinor: z.number().int(),
    paidMinor: z.number().int(),
    openMinor: z.number().int(),
    state: BillState,
    agingBucket: AgingBucket.nullable(),
    memo: z.string().nullable(),
    matterIds: z.array(z.string()),
  })
  .meta({ id: "VendorBillSummary" });

export const BoardResponse = z
  .object({
    totals: z.object({
      openMinor: z.number().int(),
      overdueMinor: z.number().int(),
      dueThisWeekMinor: z.number().int(),
      openBillCount: z.number().int(),
    }),
    vendors: z.array(
      z.object({
        vendorId: z.string(),
        vendorName: z.string().nullable(),
        openMinor: z.number().int(),
        aging: AgingAmounts,
        bills: z.array(BillSummary),
      }),
    ),
  })
  .meta({ id: "VendorBillBoard" });

export const BillDetail = BillSummary.extend({
  vendorName: z.string().nullable(),
  lines: z.array(
    z.object({
      lineIndex: z.number().int(),
      description: z.string(),
      amountMinor: z.number().int(),
      matterId: z.string().nullable(),
      matterTitle: z.string().nullable(),
      disbursementClass: z.enum(["hard", "soft"]).nullable(),
      costEntryId: z.string().nullable(),
      ledgerAccountId: z.string(),
      ledgerAccountName: z.string(),
    }),
  ),
  payments: z.array(
    z.object({
      vendorBillPaymentId: z.string(),
      operatingBankAccountId: z.string(),
      operatingBankAccountName: z.string(),
      amountMinor: z.number().int(),
      paidOn: z.string(),
      method: paymentMethod,
      checkNumber: z.number().int().nullable(),
      reference: z.string().nullable(),
    }),
  ),
  reversal: z.object({ reason: z.string(), reversedAt: z.string() }).nullable(),
}).meta({ id: "VendorBillDetail" });

export const RecordBillRequest = z
  .object({
    vendorId,
    billReference: z.string().max(100).nullable().optional(),
    billDate: civilDate,
    dueDate: civilDate.nullable().optional(),
    memo: z.string().max(2000).nullable().optional(),
    lines: z
      .array(
        z.object({
          description: z.string().min(1).max(500),
          amountMinor: z.number().int().positive(),
          matterId: identifierField("matter").nullable().optional(),
          disbursementClass: z.enum(["hard", "soft"]).nullable().optional(),
          ledgerAccountId: ledgerAccountId.nullable().optional(),
          billable: z.boolean().optional(),
          utbmsExpenseCodeId: z.string().nullable().optional(),
        }),
      )
      .min(1)
      .max(200),
  })
  .meta({ id: "RecordVendorBillRequest" });

export const PayBillsRequest = z
  .object({
    operatingBankAccountId,
    paidOn: civilDate,
    method: paymentMethod,
    reference: z.string().max(200).nullable().optional(),
    payments: z
      .array(
        z.object({
          vendorBillId,
          amountMinor: z.number().int().positive(),
          checkNumber: z.number().int().positive().nullable().optional(),
        }),
      )
      .min(1)
      .max(500),
  })
  .meta({ id: "PayVendorBillsRequest" });

export const ReverseBillRequest = z
  .object({ reason: z.string().min(1).max(2000), reversedOn: civilDate })
  .meta({ id: "ReverseVendorBillRequest" });
