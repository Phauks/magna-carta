import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { InvoiceDeliveryId, InvoiceId, UserId } from "@magna-carta/identifiers/types";
import { BillingValidationError } from "./billing-validation.ts";
import { BILLING_AGGREGATE_KEY } from "./draft.ts";
import { insertInvoiceDeliveryStatement, readInvoice } from "./statements.ts";
import type {
  BillingServiceOptions,
  InvoiceDeliveryChannel,
  InvoiceDeliveryOutcome,
} from "./types.ts";

// RECORDING THAT A BILL WAS GIVEN TO A CLIENT — and nothing more than recording it.
//
// This module transmits nothing. There is no invoice renderer here and no client-facing channel, so
// every delivery it records is one the FIRM performed: handed over at a meeting, posted, emailed from
// the firm's own mailbox, or submitted to the client's own e-billing portal. Reading that as a
// shortfall gets the design backwards. Several jurisdictions expect a client to have been given a
// bill before fees are taken from trust, and out-of-band delivery is the common case — so a record
// that could only hold deliveries the platform itself performed would leave the question unanswerable
// for exactly the firms that need to answer it.
//
// THE RECORD IS SURFACED, NEVER A GATE. Finalization is what gates an earned-fee transfer; a delivery
// is shown beside the apply-funds decision and the firm proceeds knowingly. The reasoning is
// uncomfortable and worth keeping written down: a hard delivery gate would be satisfied by firms
// recording deliveries that never happened, which converts a compliance record into a checkbox and
// makes the record worse than not having one.
//
// APPEND-ONLY, AND A SECOND DELIVERY IS A SECOND ROW. A bill posted and then emailed is two
// deliveries; a bill posted twice after the first came back is also two, and the second is the one
// that matters. Nothing here edits or withdraws a row — the database holds that unconditionally — so
// the history a firm can produce years later is the history as it accumulated.

export const INVOICE_DELIVERED_TOPIC = "billing.invoice.delivered";

export interface RecordInvoiceDeliveryInput {
  readonly invoiceId: InvoiceId;
  readonly channel: InvoiceDeliveryChannel;
  // Who it went to, in the firm's own words: an address, a mailbox, a portal account, or the person it
  // was handed to.
  readonly recipientReference: string;
  // The date the bill reached the client, supplied by the firm — not the date this row was written.
  readonly deliveryDate: string;
  readonly externalReference: string | null;
  readonly outcome: InvoiceDeliveryOutcome;
  readonly recordedBy: UserId | null;
}

export interface ComposedInvoiceDelivery {
  readonly deliveryId: InvoiceDeliveryId;
  readonly effect: EffectWrite;
}

export async function recordInvoiceDelivery(
  database: SqlDatabase,
  input: RecordInvoiceDeliveryInput,
  options: BillingServiceOptions,
): Promise<ComposedInvoiceDelivery> {
  const invoice = await readInvoice(database, input.invoiceId);
  if (!invoice) {
    throw new BillingValidationError(
      "unknown-invoice",
      `no invoice ${input.invoiceId} exists to record a delivery against`,
    );
  }
  // Finalization is the transition to evidence. A draft's lines can still change, so a delivery
  // recorded against one would assert the client was given a bill that does not yet exist in the form
  // the row describes; a voided draft was never issued to anybody. The database holds this too — a
  // route is one code path among several that will reach the table — and this is the sentence in front
  // of it, because "the delivery was refused" is not something a member can act on.
  if (invoice.status !== "final") {
    throw new BillingValidationError(
      "invoice-not-final",
      `invoice ${input.invoiceId} is ${invoice.status}: a delivery records that a finalized bill was given to a client, and a draft is still being written`,
    );
  }
  const recipientReference = input.recipientReference.trim();
  if (recipientReference.length === 0) {
    throw new BillingValidationError(
      "invoice-delivery-invalid",
      "a delivery names who received the bill: an address, a mailbox, a portal account, or the person it was handed to",
    );
  }
  // Blank and absent mean the same thing here: nothing carried it. Collapsing them keeps the column's
  // meaning single — present is a handle back to a system, and the CHECK on the table refuses the
  // whitespace-only middle ground either way.
  const trimmedExternalReference = input.externalReference?.trim() ?? "";
  const externalReference = trimmedExternalReference === "" ? null : trimmedExternalReference;
  // A delivery that predates the bill describes something that could not have happened. It is the one
  // thing about a firm-supplied date the platform can check, so it checks it — the rest of the date's
  // truth is the firm's to assert, which is what makes an out-of-band delivery recordable at all.
  if (invoice.issueDate !== null && input.deliveryDate < invoice.issueDate) {
    throw new BillingValidationError(
      "invoice-delivery-invalid",
      `a delivery on ${input.deliveryDate} predates the bill's own issue date of ${invoice.issueDate}`,
    );
  }
  const deliveryId = newIdentifier("invoiceDelivery", options.randomSource) as InvoiceDeliveryId;
  return {
    deliveryId,
    effect: {
      statements: [
        insertInvoiceDeliveryStatement(database, {
          id: deliveryId,
          invoiceId: input.invoiceId,
          channel: input.channel,
          recipientReference,
          deliveryDate: input.deliveryDate,
          externalReference,
          outcome: input.outcome,
          recordedBy: input.recordedBy,
          now: options.clock.now(),
        }),
      ],
      // Identifiers, the channel, and the outcome — no recipient reference and no external handle. A
      // client's postal address or mailbox is the client's own fact, and a topic payload fans out to
      // every subscriber's notification record; what a subscriber needs resolves behind the deep link
      // through billing's own access-checked read, which is where it belongs.
      outboxMessages: [
        {
          topic: INVOICE_DELIVERED_TOPIC,
          payload: {
            deliveryId,
            invoiceId: input.invoiceId,
            clientEntityId: invoice.clientEntityId,
            channel: input.channel,
            outcome: input.outcome,
            deliveryDate: input.deliveryDate,
          },
          aggregateKey: BILLING_AGGREGATE_KEY,
        },
      ],
    },
  };
}
