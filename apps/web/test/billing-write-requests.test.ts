/*
 * What the billing writes actually put on the wire.
 *
 * These assert the REQUEST, not the resolution. A call that resolves proves the stub answered; it
 * proves nothing about what went out, and the defect this exists to catch is a write that leaves
 * out a header the contract requires — a whole surface has been dead for exactly that reason. Every
 * one of these routes refuses a request with no `Idempotency-Key`, so a missing header is not a
 * degraded write, it is no write at all.
 *
 * The other half is the money. Every amount on this wire is a whole number of minor units, and the
 * division by a hundred happens once, at the render boundary. A body carrying a major-unit figure
 * would post a bill a hundredth of its size, silently, and correctly.
 */
import { describe, expect, it } from "vitest";
import {
  addInvoiceClaims,
  applyClientCredit,
  createInvoice,
  finalizeInvoice,
  issueCreditNote,
  recordInvoiceDelivery,
  updateInvoiceLine,
  voidInvoiceDraft,
  writeOffBalance,
} from "../src/lib/billing/billing-api.ts";
import { IDEMPOTENCY_HEADER, recordRequests } from "./time-request-recorder.ts";

const INVOICE = "invoice_00413";
const MATTER = "matter_pemberton";

describe("every billing write carries its idempotency key", () => {
  it("opens a draft with the client and the currency, keyed", async () => {
    const recorder = recordRequests({ invoiceId: INVOICE });
    await createInvoice(
      recorder.fetch,
      { clientEntityId: "entity_pemberton", currency: "USD" },
      "key-draft",
    );
    const call = recorder.onlyCall();
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/api/v1/billing/invoices");
    expect(call.headers[IDEMPOTENCY_HEADER]).toBe("key-draft");
    expect(call.body).toEqual({ clientEntityId: "entity_pemberton", currency: "USD" });
  });

  it("sends a whole batch of claims in one write, so it lands or it does not", async () => {
    const recorder = recordRequests({ claimIds: [] });
    await addInvoiceClaims(
      recorder.fetch,
      INVOICE,
      [
        { sourceKind: "time_entry", sourceId: "time_one" },
        { sourceKind: "cost_entry", sourceId: "cost_one" },
      ],
      "key-claims",
    );
    const call = recorder.onlyCall();
    expect(call.method).toBe("POST");
    expect(call.path).toBe(`/api/v1/billing/invoices/${INVOICE}/claims`);
    expect(call.headers[IDEMPOTENCY_HEADER]).toBe("key-claims");
    expect(call.body).toEqual({
      claims: [
        { sourceKind: "time_entry", sourceId: "time_one" },
        { sourceKind: "cost_entry", sourceId: "cost_one" },
      ],
    });
  });

  it("edits a LINE and never the record it was composed from", async () => {
    const recorder = recordRequests({ lineId: "line_one" });
    await updateInvoiceLine(
      recorder.fetch,
      INVOICE,
      "line_one",
      { description: "Professional services", amountMinor: 125_000 },
      "key-line",
    );
    const call = recorder.onlyCall();
    expect(call.method).toBe("PATCH");
    expect(call.path).toBe(`/api/v1/billing/invoices/${INVOICE}/lines/line_one`);
    expect(call.headers[IDEMPOTENCY_HEADER]).toBe("key-line");
    // Minor units, exactly as held. A major-unit figure here would bill $1,250 as $125,000.
    expect(call.body).toEqual({ description: "Professional services", amountMinor: 125_000 });
  });

  it("finalizes with its dates, keyed, because a retry must not draw a second number", async () => {
    const recorder = recordRequests({ invoiceId: INVOICE, invoiceNumber: "00413", totalMinor: 0 });
    await finalizeInvoice(
      recorder.fetch,
      INVOICE,
      { issueDate: "2026-08-05", dueDate: "2026-09-04" },
      "key-finalize",
    );
    const call = recorder.onlyCall();
    expect(call.method).toBe("POST");
    expect(call.path).toBe(`/api/v1/billing/invoices/${INVOICE}/finalization`);
    expect(call.headers[IDEMPOTENCY_HEADER]).toBe("key-finalize");
    expect(call.body).toEqual({ issueDate: "2026-08-05", dueDate: "2026-09-04" });
  });

  it("voids a draft with the reason somebody reads years later", async () => {
    const recorder = recordRequests({ invoiceId: INVOICE });
    await voidInvoiceDraft(recorder.fetch, INVOICE, "Raised against the wrong period", "key-void");
    const call = recorder.onlyCall();
    expect(call.method).toBe("POST");
    expect(call.path).toBe(`/api/v1/billing/invoices/${INVOICE}/void`);
    expect(call.headers[IDEMPOTENCY_HEADER]).toBe("key-void");
    expect(call.body).toEqual({ reason: "Raised against the wrong period" });
  });

  it("records a correction beside the bill in minor units, keyed", async () => {
    const recorder = recordRequests({});
    await issueCreditNote(
      recorder.fetch,
      INVOICE,
      {
        reason: "Charged twice",
        effectiveDate: "2026-08-20",
        lines: [
          { matterId: MATTER, kind: "fee", description: "Duplicate charge", amountMinor: 40_000 },
        ],
      },
      "key-credit",
    );
    const call = recorder.onlyCall();
    expect(call.method).toBe("POST");
    expect(call.path).toBe(`/api/v1/billing/invoices/${INVOICE}/credit-notes`);
    expect(call.headers[IDEMPOTENCY_HEADER]).toBe("key-credit");
    expect(call.body).toEqual({
      reason: "Charged twice",
      effectiveDate: "2026-08-20",
      lines: [
        { matterId: MATTER, kind: "fee", description: "Duplicate charge", amountMinor: 40_000 },
      ],
    });
  });

  it("writes off a balance against the matter that owes it", async () => {
    const recorder = recordRequests({ applicationId: "application_one" });
    await writeOffBalance(
      recorder.fetch,
      INVOICE,
      {
        matterId: MATTER,
        amountMinor: 25_000,
        reason: "Not recoverable",
        effectiveDate: "2026-08-30",
      },
      "key-writeoff",
    );
    const call = recorder.onlyCall();
    expect(call.headers[IDEMPOTENCY_HEADER]).toBe("key-writeoff");
    expect(call.body).toEqual({
      matterId: MATTER,
      amountMinor: 25_000,
      reason: "Not recoverable",
      effectiveDate: "2026-08-30",
    });
  });

  it("sets a client credit against a bill without moving any money", async () => {
    const recorder = recordRequests({ applicationId: "application_two", remainingMinor: 0 });
    await applyClientCredit(
      recorder.fetch,
      "credit_one",
      { invoiceId: INVOICE, matterId: MATTER, amountMinor: 12_000, effectiveDate: "2026-08-30" },
      "key-apply",
    );
    const call = recorder.onlyCall();
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/api/v1/billing/client-credits/credit_one/applications");
    expect(call.headers[IDEMPOTENCY_HEADER]).toBe("key-apply");
    expect(call.body).toEqual({
      invoiceId: INVOICE,
      matterId: MATTER,
      amountMinor: 12_000,
      effectiveDate: "2026-08-30",
    });
  });

  it("records a delivery the FIRM made, never one the platform sent", async () => {
    const recorder = recordRequests({ deliveryId: "delivery_one" });
    await recordInvoiceDelivery(
      recorder.fetch,
      INVOICE,
      {
        channel: "email",
        recipientReference: "billing@pemberton.example",
        deliveryDate: "2026-08-06",
        outcome: "delivered",
      },
      "key-delivery",
    );
    const call = recorder.onlyCall();
    expect(call.method).toBe("POST");
    expect(call.path).toBe(`/api/v1/billing/invoices/${INVOICE}/deliveries`);
    expect(call.headers[IDEMPOTENCY_HEADER]).toBe("key-delivery");
    expect(call.body).toEqual({
      channel: "email",
      recipientReference: "billing@pemberton.example",
      deliveryDate: "2026-08-06",
      outcome: "delivered",
    });
  });
});
