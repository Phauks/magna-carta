import type { InvoiceId, MatterId, TrustLedgerNodeId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  invoiceBackedEarnedFeePrecondition,
  type ResolvedEarnedFeeApplications,
} from "../src/earned-fee.ts";

// The port contract itself, exercised directly.
//
// These arms are a RE-CHECK: they assert that the transfer trust is about to compose is the one
// billing authorized, and in the shipped wiring they cannot fire, because the apply-funds service
// hands trust the same leaf and the same total it resolved against. That is exactly why they are
// worth testing here rather than through the service — the service cannot produce the disagreement,
// and the port exists so that a future caller which could produce one is refused rather than obeyed.
//
// Widening trust's port with an invoice reference would make trust know what an invoice is and buy
// nothing; these four fields are enough precisely because the precondition already knows the answer.

const NODE = "trustLedgerNode_leaf" as TrustLedgerNodeId;
const MATTER = "matter_one" as MatterId;

const resolution: ResolvedEarnedFeeApplications = {
  nodeId: NODE,
  matterId: MATTER,
  clientEntityId: "directoryOrganization_acme",
  currency: "USD",
  totalMinor: 500_00,
  applications: [
    {
      invoiceId: "invoice_one" as InvoiceId,
      matterId: MATTER,
      amountMinor: 500_00,
      currency: "USD",
      unpaidMinor: 500_00,
    },
  ],
};

const context = {
  nodeId: NODE,
  matterId: MATTER,
  amountMinor: 500_00,
  currency: "USD",
} as const;

describe("the earned-fee precondition — the re-check at the trust boundary", () => {
  it("permits the transfer it authorized", async () => {
    await expect(
      invoiceBackedEarnedFeePrecondition(resolution).assertTransferPermitted(context),
    ).resolves.toBeUndefined();
  });

  it("refuses a transfer drawing on a different client ledger than the invoices were checked against", async () => {
    // Without this, the applications could name one matter's invoices while the money came out of
    // another matter's leaf — which is the misappropriation pattern the whole check exists for.
    await expect(
      invoiceBackedEarnedFeePrecondition(resolution).assertTransferPermitted({
        ...context,
        nodeId: "trustLedgerNode_other" as TrustLedgerNodeId,
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "earned-fee-node-mismatch" }) as Error);
  });

  it("refuses a transfer for a different matter than the invoices were checked against", async () => {
    await expect(
      invoiceBackedEarnedFeePrecondition(resolution).assertTransferPermitted({
        ...context,
        matterId: "matter_two" as MatterId,
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "earned-fee-node-mismatch" }) as Error);
  });

  it("refuses a transfer whose amount the named invoices do not account for", async () => {
    // Larger takes money out of trust no bill accounts for; smaller applies more to the invoices
    // than actually moved. Both directions refuse.
    for (const amountMinor of [500_01, 499_99]) {
      await expect(
        invoiceBackedEarnedFeePrecondition(resolution).assertTransferPermitted({
          ...context,
          amountMinor,
        }),
      ).rejects.toThrow(expect.objectContaining({ code: "earned-fee-amount-mismatch" }) as Error);
    }
  });

  it("refuses a transfer denominated in another currency", async () => {
    await expect(
      invoiceBackedEarnedFeePrecondition(resolution).assertTransferPermitted({
        ...context,
        currency: "EUR",
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "application-currency-mismatch" }) as Error);
  });

  it("refuses a transfer against a matter-less trust node", async () => {
    // A roll-up node carries no matter. Postings land on matter LEAVES, and a fee taken against a
    // client-level roll-up would be a fee attributed to no matter at all.
    await expect(
      invoiceBackedEarnedFeePrecondition(resolution).assertTransferPermitted({
        ...context,
        matterId: null,
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "earned-fee-node-mismatch" }) as Error);
  });
});
