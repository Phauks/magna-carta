import { z } from "@hono/zod-openapi";
import { PAYMENT_RECEIPT_METHODS, recordPaymentReceipt } from "@magna-carta/billing/receipt";
import { identifierField } from "@magna-carta/identifiers/field";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../../chokepoint/context-accessors.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import {
  APPLY,
  type BillingApp,
  civilDate,
  clockOptions,
  mutationResponses,
  runBillingEffect,
  writeMeta,
} from "./billing.ts";

// Payments recorded by hand against a bill. The composition is billing's (packages/billing/src/
// receipt.ts) and the commit is the shared billing effect, so a refusal here reads exactly as a
// write-off's or a credit note's does.

const invoiceParam = z.object({ invoiceId: identifierPathParam("invoice", "invoiceId") });

const PaymentReceiptRequest = z
  .object({
    matterId: identifierField("matter"),
    amountMinor: z.number().int().positive(),
    method: z.enum(PAYMENT_RECEIPT_METHODS),
    reference: z.string().max(200).nullable().optional(),
    effectiveDate: civilDate,
  })
  .openapi("BillingPaymentReceiptRequest");

const PaymentReceiptAck = z
  .object({
    receiptId: z.string(),
    applicationId: z.string(),
    invoiceId: z.string(),
    matterId: z.string(),
  })
  .openapi("BillingPaymentReceiptAck");

const recordPaymentRoute = defineOpenAPIRoute(writeMeta("billing.recordPayment", APPLY), {
  method: "post",
  path: "/api/v1/billing/invoices/{invoiceId}/payments",
  description:
    "Records a payment the firm received by hand against what one matter owes on a bill: a check, cash, a bank transfer, or a card run on the firm's own terminal. The money is booked into the firm's operating bank account and the bill's balance comes down by the same amount. It cannot exceed what the matter still owes on the bill; record what is owed and return or credit the rest. Money a client sends to be held in trust is a trust deposit, not a payment, and is recorded on the client's trust ledger instead. A payment recorded in error is undone by reversing it, which keeps both records.",
  request: {
    headers: idempotencyKeyHeader,
    params: invoiceParam,
    body: { content: { "application/json": { schema: PaymentReceiptRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The payment was recorded",
      content: { "application/json": { schema: PaymentReceiptAck } },
    },
    ...mutationResponses,
  },
});

export function registerPaymentRoutes(app: BillingApp, chokepoint: Chokepoint): void {
  app.openapi(
    { ...recordPaymentRoute, middleware: chokepointMiddleware(chokepoint, recordPaymentRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { invoiceId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof PaymentReceiptAck>>(
        c,
        201,
        async (recordedBy) => {
          const composed = await recordPaymentReceipt(
            firm.firmDatabase,
            {
              invoiceId,
              matterId: request.matterId,
              amountMinor: request.amountMinor,
              method: request.method,
              reference: request.reference ?? null,
              effectiveDate: request.effectiveDate,
              recordedBy,
            },
            clockOptions(),
          );
          return {
            write: composed.effect,
            body: {
              receiptId: composed.receiptId,
              applicationId: composed.applicationId,
              invoiceId,
              matterId: request.matterId,
            },
          };
        },
      );
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );
}
