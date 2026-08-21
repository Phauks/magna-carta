import { describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { InvoiceId, MatterId } from "@magna-carta/identifiers/types";
import { INVOICE_DELIVERED_TOPIC, recordInvoiceDelivery } from "../src/delivery.ts";
import { addClaimsToDraft, createInvoiceDraft } from "../src/draft.ts";
import { finalizeInvoice } from "../src/finalize.ts";
import { deliveriesOfBillsThatWereNeverIssuedStatement } from "../src/fitness.ts";
import {
  readInvoiceDeliveries,
  readInvoiceDeliveryState,
  readInvoiceDeliveryStates,
} from "../src/statements.ts";
import {
  billingFixture,
  commit,
  expectRefusal,
  mapAccountRoles,
  options,
  seedMatter,
  seedTimeEntry,
  type BillingFixture,
} from "./support.ts";

const FINALIZE_DATES = { issueDate: "2026-08-03", dueDate: "2026-09-04" } as const;
const CLIENT = "entity_client";

const DELIVERY_ROLES = ["accounts_receivable", "fee_income"] as const;

interface Bill {
  readonly invoiceId: InvoiceId;
  readonly matterId: MatterId;
}

// One matter, one hour of work, one finalized bill — the only thing a delivery needs, since a delivery
// is a record about a bill rather than anything derived from its contents.
async function finalizedBill(fixture: BillingFixture, amountMinor = 25_000): Promise<Bill> {
  const matterId = await seedMatter(fixture, CLIENT, "Acme");
  const timeEntryId = await seedTimeEntry(fixture, matterId, { amountMinor });
  const draft = createInvoiceDraft(
    fixture.database,
    { clientEntityId: CLIENT, currency: "USD", createdBy: null },
    options,
  );
  await commit(fixture.database, draft.effect);
  const claimed = await addClaimsToDraft(
    fixture.database,
    draft.invoiceId,
    [{ sourceKind: "time_entry", sourceId: timeEntryId }],
    options,
  );
  await commit(fixture.database, claimed.effect);
  const finalized = await finalizeInvoice(
    fixture.database,
    { invoiceId: draft.invoiceId, ...FINALIZE_DATES, finalizedBy: null },
    options,
  );
  await commit(fixture.database, finalized.effect);
  return { invoiceId: draft.invoiceId, matterId };
}

// A draft, deliberately never finalized.
async function draftBill(fixture: BillingFixture): Promise<InvoiceId> {
  const draft = createInvoiceDraft(
    fixture.database,
    { clientEntityId: CLIENT, currency: "USD", createdBy: null },
    options,
  );
  await commit(fixture.database, draft.effect);
  return draft.invoiceId;
}

async function deliveredFixture(): Promise<BillingFixture> {
  const fixture = await billingFixture();
  await mapAccountRoles(fixture, DELIVERY_ROLES);
  return fixture;
}

describe("recording that a bill was given to a client", () => {
  it("records the attempt and answers the question the record exists for", async () => {
    const fixture = await deliveredFixture();
    const bill = await finalizedBill(fixture);

    const before = await readInvoiceDeliveryState(fixture.database, bill.invoiceId);
    expect(before).toMatchObject({ delivered: false, deliveredOn: null, attemptCount: 0 });

    const recorded = await recordInvoiceDelivery(
      fixture.database,
      {
        invoiceId: bill.invoiceId,
        channel: "post",
        recipientReference: "12 Court Street, Reno NV",
        deliveryDate: "2026-08-04",
        externalReference: "RR123456789US",
        outcome: "delivered",
        recordedBy: fixture.memberUserId,
      },
      options,
    );
    await commit(fixture.database, recorded.effect);

    const state = await readInvoiceDeliveryState(fixture.database, bill.invoiceId);
    expect(state).toMatchObject({
      delivered: true,
      deliveredOn: "2026-08-04",
      attemptCount: 1,
      failedAttemptCount: 0,
      lastAttemptOn: "2026-08-04",
    });

    const [attempt] = (await readInvoiceDeliveries(fixture.database, bill.invoiceId)).rows;
    expect(attempt).toMatchObject({
      channel: "post",
      recipientReference: "12 Court Street, Reno NV",
      externalReference: "RR123456789US",
      outcome: "delivered",
      recordedBy: fixture.memberUserId,
    });
  });

  it("emits the delivered topic carrying identifiers, and never the client's address", async () => {
    const fixture = await deliveredFixture();
    const bill = await finalizedBill(fixture);
    const recorded = await recordInvoiceDelivery(
      fixture.database,
      {
        invoiceId: bill.invoiceId,
        channel: "hand",
        recipientReference: "handed to the client at the closing meeting",
        deliveryDate: "2026-08-05",
        externalReference: null,
        outcome: "delivered",
        recordedBy: fixture.memberUserId,
      },
      options,
    );
    const [message] = recorded.effect.outboxMessages;
    expect(message?.topic).toBe(INVOICE_DELIVERED_TOPIC);
    expect(message?.payload).toMatchObject({
      deliveryId: recorded.deliveryId,
      invoiceId: bill.invoiceId,
      channel: "hand",
      outcome: "delivered",
    });
    // The recipient reference is a client's own fact and a topic payload fans out to every
    // subscriber's notification record. It resolves behind the deep link or not at all.
    expect(JSON.stringify(message?.payload)).not.toContain("closing meeting");
  });

  it("a second delivery is a second row, and the date is the FIRST success", async () => {
    const fixture = await deliveredFixture();
    const bill = await finalizedBill(fixture);
    for (const attempt of [
      { channel: "post", date: "2026-08-04", outcome: "failed" },
      { channel: "post", date: "2026-08-11", outcome: "delivered" },
      { channel: "email", date: "2026-08-20", outcome: "delivered" },
    ] as const) {
      const recorded = await recordInvoiceDelivery(
        fixture.database,
        {
          invoiceId: bill.invoiceId,
          channel: attempt.channel,
          recipientReference: "the client's address of record",
          deliveryDate: attempt.date,
          externalReference: null,
          outcome: attempt.outcome,
          recordedBy: fixture.memberUserId,
        },
        options,
      );
      await commit(fixture.database, recorded.effect);
    }

    const attempts = await readInvoiceDeliveries(fixture.database, bill.invoiceId);
    expect(attempts.rows).toHaveLength(3);
    expect(attempts.capped).toBe(false);

    // The list is capped rather than paged, so the flag is the only thing separating a short answer
    // from a complete one — and the state summary beside it counts every attempt either way, which
    // is what makes the cap safe here.
    const cut = await readInvoiceDeliveries(fixture.database, bill.invoiceId, 2);
    expect(cut.rows).toHaveLength(2);
    expect(cut.capped).toBe(true);
    // Not the latest. What a jurisdiction asks is when the client was FIRST given the bill — a
    // courtesy re-send weeks later does not move the date the clock ran from.
    expect(await readInvoiceDeliveryState(fixture.database, bill.invoiceId)).toMatchObject({
      delivered: true,
      deliveredOn: "2026-08-11",
      attemptCount: 3,
      failedAttemptCount: 1,
      lastAttemptOn: "2026-08-20",
    });
  });

  it("distinguishes a bill never sent from a bill chased and not landed", async () => {
    const fixture = await deliveredFixture();
    const never = await finalizedBill(fixture);
    const chased = await finalizedBill(fixture);
    for (const date of ["2026-08-04", "2026-08-18"]) {
      const recorded = await recordInvoiceDelivery(
        fixture.database,
        {
          invoiceId: chased.invoiceId,
          channel: "post",
          recipientReference: "12 Court Street, Reno NV",
          deliveryDate: date,
          externalReference: null,
          outcome: "failed",
          recordedBy: fixture.memberUserId,
        },
        options,
      );
      await commit(fixture.database, recorded.effect);
    }

    // Both are "not delivered", and collapsing them into one message would tell a firm nothing it
    // needs: one bill has never been sent, the other has been chased twice and has not landed.
    expect(await readInvoiceDeliveryState(fixture.database, never.invoiceId)).toMatchObject({
      delivered: false,
      attemptCount: 0,
      failedAttemptCount: 0,
    });
    expect(await readInvoiceDeliveryState(fixture.database, chased.invoiceId)).toMatchObject({
      delivered: false,
      attemptCount: 2,
      failedAttemptCount: 2,
      lastAttemptOn: "2026-08-18",
    });
  });

  it("answers for a set of bills in one query, including the ones with no rows", async () => {
    const fixture = await deliveredFixture();
    const delivered = await finalizedBill(fixture);
    const silent = await finalizedBill(fixture);
    const recorded = await recordInvoiceDelivery(
      fixture.database,
      {
        invoiceId: delivered.invoiceId,
        channel: "e_billing_gateway",
        recipientReference: "the client's e-billing portal account",
        deliveryDate: "2026-08-06",
        externalReference: "SUB-99812",
        outcome: "delivered",
        recordedBy: fixture.memberUserId,
      },
      options,
    );
    await commit(fixture.database, recorded.effect);

    const states = await readInvoiceDeliveryStates(fixture.database, [
      delivered.invoiceId,
      silent.invoiceId,
    ]);
    expect(states.get(delivered.invoiceId)).toMatchObject({
      delivered: true,
      deliveredOn: "2026-08-06",
    });
    // Present with a zeroed state rather than absent: "no delivery has been recorded" is the answer
    // the caller asked for, and a missing key would make every caller re-derive it.
    expect(states.get(silent.invoiceId)).toMatchObject({ delivered: false, attemptCount: 0 });
  });
});

describe("a delivery records a finalized bill, and only a finalized bill", () => {
  it("refuses a draft by name, and the trigger holds when the service is bypassed", async () => {
    const fixture = await deliveredFixture();
    const draftInvoiceId = await draftBill(fixture);

    await expect(
      recordInvoiceDelivery(
        fixture.database,
        {
          invoiceId: draftInvoiceId,
          channel: "post",
          recipientReference: "12 Court Street, Reno NV",
          deliveryDate: "2026-08-04",
          externalReference: null,
          outcome: "delivered",
          recordedBy: null,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "invoice-not-final" });

    // The guarantee under the sentence: a hand-built insert against the same draft aborts. A route is
    // one code path among several that will reach this table.
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            `INSERT INTO invoice_delivery (id, invoice_id, channel, recipient_reference, delivery_date, outcome, recorded_at)
             VALUES (?1, ?2, 'post', '12 Court Street', '2026-08-04', 'delivered', ?3)`,
          )
          .bind(newIdentifier("invoiceDelivery"), draftInvoiceId, "2026-08-04T00:00:00.000Z")
          .run(),
      ),
    ).rejects.toThrow(/records that a finalized bill was given to a client/);
  });

  it("refuses an unknown bill rather than recording a delivery of nothing", async () => {
    const fixture = await deliveredFixture();
    await expect(
      recordInvoiceDelivery(
        fixture.database,
        {
          invoiceId: newIdentifier("invoice") as InvoiceId,
          channel: "post",
          recipientReference: "12 Court Street, Reno NV",
          deliveryDate: "2026-08-04",
          externalReference: null,
          outcome: "delivered",
          recordedBy: null,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "unknown-invoice" });
  });

  it("refuses a delivery that predates the bill, at both layers", async () => {
    const fixture = await deliveredFixture();
    const bill = await finalizedBill(fixture);

    await expect(
      recordInvoiceDelivery(
        fixture.database,
        {
          invoiceId: bill.invoiceId,
          channel: "post",
          recipientReference: "12 Court Street, Reno NV",
          // The bill was issued on 2026-08-03.
          deliveryDate: "2026-08-01",
          externalReference: null,
          outcome: "delivered",
          recordedBy: null,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "invoice-delivery-invalid" });

    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            `INSERT INTO invoice_delivery (id, invoice_id, channel, recipient_reference, delivery_date, outcome, recorded_at)
             VALUES (?1, ?2, 'post', '12 Court Street', '2026-08-01', 'delivered', ?3)`,
          )
          .bind(newIdentifier("invoiceDelivery"), bill.invoiceId, "2026-08-04T00:00:00.000Z")
          .run(),
      ),
    ).rejects.toThrow(/cannot predate the bill it delivered/);
  });

  it("refuses a delivery that cannot say who received it, at both layers", async () => {
    const fixture = await deliveredFixture();
    const bill = await finalizedBill(fixture);

    await expect(
      recordInvoiceDelivery(
        fixture.database,
        {
          invoiceId: bill.invoiceId,
          channel: "post",
          recipientReference: "   ",
          deliveryDate: "2026-08-04",
          externalReference: null,
          outcome: "delivered",
          recordedBy: null,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "invoice-delivery-invalid" });

    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            `INSERT INTO invoice_delivery (id, invoice_id, channel, recipient_reference, delivery_date, outcome, recorded_at)
             VALUES (?1, ?2, 'post', '  ', '2026-08-04', 'delivered', ?3)`,
          )
          .bind(newIdentifier("invoiceDelivery"), bill.invoiceId, "2026-08-04T00:00:00.000Z")
          .run(),
      ),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it("holds the channel and outcome vocabularies closed", async () => {
    const fixture = await deliveredFixture();
    const bill = await finalizedBill(fixture);
    for (const [channel, outcome] of [
      ["carrier_pigeon", "delivered"],
      ["post", "opened"],
    ] as const) {
      await expect(
        expectRefusal(() =>
          fixture.database
            .prepare(
              `INSERT INTO invoice_delivery (id, invoice_id, channel, recipient_reference, delivery_date, outcome, recorded_at)
               VALUES (?1, ?2, ?3, '12 Court Street', '2026-08-04', ?4, ?5)`,
            )
            .bind(
              newIdentifier("invoiceDelivery"),
              bill.invoiceId,
              channel,
              outcome,
              "2026-08-04T00:00:00.000Z",
            )
            .run(),
        ),
      ).rejects.toThrow(/CHECK constraint failed/);
    }
  });
});

describe("a recorded delivery is evidence, so it is append-only", () => {
  it("refuses an update, a delete, and an INSERT OR REPLACE over the same row", async () => {
    const fixture = await deliveredFixture();
    const bill = await finalizedBill(fixture);
    const recorded = await recordInvoiceDelivery(
      fixture.database,
      {
        invoiceId: bill.invoiceId,
        channel: "post",
        recipientReference: "12 Court Street, Reno NV",
        deliveryDate: "2026-08-04",
        externalReference: null,
        outcome: "failed",
        recordedBy: fixture.memberUserId,
      },
      options,
    );
    await commit(fixture.database, recorded.effect);

    // The exact edit a firm would reach for — turning a failed attempt into a successful one — and the
    // reason the table refuses it: that is the row a bar audit reads.
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("UPDATE invoice_delivery SET outcome = 'delivered' WHERE id = ?1")
          .bind(recorded.deliveryId)
          .run(),
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("DELETE FROM invoice_delivery WHERE id = ?1")
          .bind(recorded.deliveryId)
          .run(),
      ),
    ).rejects.toThrow(/append-only/);
    // REPLACE deletes-then-reinserts without firing either of the two triggers above, which is why
    // there is a third one on the insert half.
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            `INSERT OR REPLACE INTO invoice_delivery (id, invoice_id, channel, recipient_reference, delivery_date, outcome, recorded_at)
             VALUES (?1, ?2, 'post', '12 Court Street', '2026-08-04', 'delivered', ?3)`,
          )
          .bind(recorded.deliveryId, bill.invoiceId, "2026-08-04T00:00:00.000Z")
          .run(),
      ),
    ).rejects.toThrow(/append-only/);

    // And the row still says what it said.
    expect(await readInvoiceDeliveryState(fixture.database, bill.invoiceId)).toMatchObject({
      delivered: false,
      attemptCount: 1,
      failedAttemptCount: 1,
    });
  });

  it("re-proves over stored rows that no delivery describes a bill that was never issued", async () => {
    const fixture = await deliveredFixture();
    const bill = await finalizedBill(fixture);
    await draftBill(fixture);
    const recorded = await recordInvoiceDelivery(
      fixture.database,
      {
        invoiceId: bill.invoiceId,
        channel: "post",
        recipientReference: "12 Court Street, Reno NV",
        deliveryDate: "2026-08-04",
        externalReference: null,
        outcome: "delivered",
        recordedBy: null,
      },
      options,
    );
    await commit(fixture.database, recorded.effect);

    const { results } = await deliveriesOfBillsThatWereNeverIssuedStatement(fixture.database).all();
    expect(results).toEqual([]);
  });
});
