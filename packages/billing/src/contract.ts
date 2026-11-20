import { z } from "zod";
import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { identifierField } from "@magna-carta/identifiers/field";
import { isValidCalendarDate } from "@magna-carta/ledger/validate";
import { MAXIMUM_FEES_PER_DEPOSIT, MAXIMUM_LINES_PER_DEPOSIT } from "./deposit.ts";
import { PAYMENT_METHODS } from "./payment-methods.ts";

// Billing's contract for payments recorded by hand: what the deposit routes accept in a request body
// and return in a response, as plain zod. Each component is named with zod's own metadata
// (`.meta({ id })`), which the contract emitter reads as the component's name, so the route module in
// apps/api-worker declares its routes over these without restating a field. Path parameters stay
// with the routes: they are addressing, not domain shape.

// A real calendar date, not only its shape: the bare pattern accepts 2026-02-30.
const civilDate = () =>
  z
    .string()
    .regex(CIVIL_DATE_PATTERN)
    .refine(isValidCalendarDate, { message: "not a calendar date" });

const text = (max: number) => z.string().max(max);

const DepositLine = z.object({
  invoiceId: identifierField("invoice"),
  matterId: identifierField("matter"),
  amountMinor: z.number().int().positive(),
  method: z.enum(PAYMENT_METHODS),
  reference: text(200).nullable().optional(),
  receivedFrom: text(200),
  receivedOn: civilDate(),
  memo: text(200).nullable().optional(),
  details: z
    .record(z.string(), z.union([z.string(), z.record(z.string(), z.number().int()), z.null()]))
    .optional(),
  note: text(4000).nullable().optional(),
});

export const RecordDepositRequest = z
  .object({
    depositToAccountId: identifierField("ledgerAccount"),
    depositedOn: civilDate(),
    slipNumber: text(200).nullable().optional(),
    lines: z.array(DepositLine).min(1).max(MAXIMUM_LINES_PER_DEPOSIT),
    fees: z
      .array(z.object({ description: text(200), amountMinor: z.number().int().positive() }))
      .max(MAXIMUM_FEES_PER_DEPOSIT)
      .optional(),
    note: text(4000).nullable().optional(),
  })
  .meta({ id: "BillingRecordDepositRequest" });

export const RecordDepositAck = z
  .object({ depositId: z.string(), receiptIds: z.array(z.string()) })
  .meta({ id: "BillingRecordDepositAck" });

export const DepositDetail = z
  .object({
    id: z.string(),
    depositToAccountId: z.string(),
    depositToName: z.string(),
    depositedOn: z.string(),
    slipNumber: z.string().nullable(),
    currency: z.string(),
    paymentsMinor: z.number().int(),
    feesMinor: z.number().int(),
    depositMinor: z.number().int(),
    recordedBy: z.string().nullable(),
    recordedAt: z.string(),
    lines: z.array(
      z.object({
        receiptId: z.string(),
        lineNumber: z.number().int(),
        invoiceId: z.string(),
        invoiceNumber: z.string().nullable(),
        matterId: z.string(),
        matterNumber: z.string().nullable(),
        matterTitle: z.string(),
        method: z.enum(PAYMENT_METHODS),
        reference: z.string().nullable(),
        receivedFrom: z.string(),
        receivedOn: z.string(),
        amountMinor: z.number().int(),
        memo: z.string().nullable(),
        details: z.record(z.string(), z.union([z.string(), z.record(z.string(), z.number())])),
        reversed: z.boolean(),
      }),
    ),
    fees: z.array(
      z.object({
        lineNumber: z.number().int(),
        description: z.string(),
        amountMinor: z.number().int(),
      }),
    ),
    notes: z.array(
      z.object({
        id: z.string(),
        receiptId: z.string().nullable(),
        body: z.string(),
        writtenBy: z.string().nullable(),
        writtenAt: z.string(),
      }),
    ),
    files: z.array(
      z.object({
        id: z.string(),
        receiptId: z.string().nullable(),
        kind: z.enum(["scan", "file"]),
        name: z.string(),
        contentType: z.string(),
        sizeBytes: z.number().int(),
        recordedAt: z.string(),
      }),
    ),
  })
  .meta({ id: "BillingDepositDetail" });

export const OpenBills = z
  .object({
    bills: z.array(
      z.object({
        invoiceId: z.string(),
        invoiceNumber: z.string().nullable(),
        issueDate: z.string().nullable(),
        matterId: z.string(),
        matterNumber: z.string().nullable(),
        matterTitle: z.string(),
        clientName: z.string().nullable(),
        currency: z.string(),
        owedMinor: z.number().int(),
      }),
    ),
  })
  .meta({ id: "BillingOpenBills" });

export const DepositNoteRequest = z
  .object({ receiptId: identifierField("paymentReceipt").nullable().optional(), body: text(4000) })
  .meta({ id: "BillingDepositNoteRequest" });

export const DepositFileRequest = z
  .object({
    receiptId: identifierField("paymentReceipt").nullable().optional(),
    kind: z.enum(["scan", "file"]),
    name: text(200).min(1),
    dataBase64: z.string(),
  })
  .meta({ id: "BillingDepositFileRequest" });

export const Acknowledged = z.object({ id: z.string() }).meta({ id: "BillingDepositAcknowledged" });
