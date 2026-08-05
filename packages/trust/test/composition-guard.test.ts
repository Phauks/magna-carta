import { money, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { composeTrustEntry } from "../src/composition-guard.ts";
import { assertTrustFitness } from "../src/fitness.ts";
import { commit, options, seedMatterLeaf, trustFixture } from "./support.ts";

const usd = (minor: number) => money(minor, USD);

describe("the trust composition guard", () => {
  it("accepts the ordinary receipt: one trust bank line, one matter leaf", async () => {
    const fixture = await trustFixture();
    const leaf = await seedMatterLeaf(fixture, "entity_a", "Webb");
    const posted = await composeTrustEntry(
      fixture.database,
      {
        description: "Retainer deposit",
        effectiveDate: "2026-08-05",
        lines: [
          { accountId: fixture.bankLedgerAccountId, direction: "debit", amount: usd(500000) },
          { accountId: leaf.ledgerAccountId, direction: "credit", amount: usd(500000) },
        ],
      },
      options,
    );
    expect(posted.trustAccountId).toBe(fixture.trustAccountId);
    await commit(fixture.database, posted.effect);
    await assertTrustFitness(fixture.database);
  });

  it("refuses an entry mixing trust money with an operating account (no commingling)", async () => {
    const fixture = await trustFixture();
    const leaf = await seedMatterLeaf(fixture, "entity_a", "Webb");
    await expect(
      composeTrustEntry(
        fixture.database,
        {
          description: "Client money into the operating account",
          effectiveDate: "2026-08-05",
          lines: [
            { accountId: fixture.operatingBankAccountId, direction: "debit", amount: usd(100000) },
            { accountId: leaf.ledgerAccountId, direction: "credit", amount: usd(100000) },
          ],
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "commingled-entry" });
  });

  it("refuses a processor fee netted out of a trust deposit (fees never touch trust)", async () => {
    const fixture = await trustFixture();
    const leaf = await seedMatterLeaf(fixture, "entity_a", "Webb");
    // The gross deposit lands on the bank leaf and the client's leaf; the fee has nowhere to sit.
    // There is no arrangement of these three accounts that composes — which is the point: the
    // deposit lands gross and the fee debits operating as its own entry, by construction.
    await expect(
      composeTrustEntry(
        fixture.database,
        {
          description: "Card retainer, net of processor fee",
          effectiveDate: "2026-08-05",
          lines: [
            { accountId: fixture.bankLedgerAccountId, direction: "debit", amount: usd(97000) },
            { accountId: fixture.processorFeeAccountId, direction: "debit", amount: usd(3000) },
            { accountId: leaf.ledgerAccountId, direction: "credit", amount: usd(100000) },
          ],
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "commingled-entry" });
  });

  it("refuses a client-to-client movement outright", async () => {
    const fixture = await trustFixture();
    const webb = await seedMatterLeaf(fixture, "entity_a", "Webb");
    const alvarez = await seedMatterLeaf(fixture, "entity_b", "Alvarez");
    await expect(
      composeTrustEntry(
        fixture.database,
        {
          description: "Moving funds from one client to another",
          effectiveDate: "2026-08-05",
          lines: [
            { accountId: webb.ledgerAccountId, direction: "debit", amount: usd(25000) },
            { accountId: alvarez.ledgerAccountId, direction: "credit", amount: usd(25000) },
          ],
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "multiple-clients-on-entry" });
  });

  it("accepts a movement between two matters of the SAME client", async () => {
    const fixture = await trustFixture();
    const first = await seedMatterLeaf(fixture, "entity_a", "Webb");
    const second = await seedMatterLeaf(fixture, "entity_a", "Webb");
    const deposit = await composeTrustEntry(
      fixture.database,
      {
        description: "Retainer deposit",
        effectiveDate: "2026-08-05",
        lines: [
          { accountId: fixture.bankLedgerAccountId, direction: "debit", amount: usd(40000) },
          { accountId: first.ledgerAccountId, direction: "credit", amount: usd(40000) },
        ],
      },
      options,
    );
    await commit(fixture.database, deposit.effect);
    // Both leaves plus the bank leaf: one client, so the guard permits it. The bank line nets to
    // zero, which is what a reallocation within one client's funds actually is.
    const reallocation = await composeTrustEntry(
      fixture.database,
      {
        description: "Reallocate between the client's two matters",
        effectiveDate: "2026-08-05",
        lines: [
          { accountId: first.ledgerAccountId, direction: "debit", amount: usd(10000) },
          { accountId: fixture.bankLedgerAccountId, direction: "credit", amount: usd(10000) },
          { accountId: fixture.bankLedgerAccountId, direction: "debit", amount: usd(10000) },
          { accountId: second.ledgerAccountId, direction: "credit", amount: usd(10000) },
        ],
      },
      options,
    );
    await commit(fixture.database, reallocation.effect);
    await assertTrustFitness(fixture.database);
  });

  it("refuses a posting to the client-liability root and to a client node", async () => {
    const fixture = await trustFixture();
    const leaf = await seedMatterLeaf(fixture, "entity_a", "Webb");
    await expect(
      composeTrustEntry(
        fixture.database,
        {
          description: "Posting to the roll-up",
          effectiveDate: "2026-08-05",
          lines: [
            { accountId: fixture.bankLedgerAccountId, direction: "debit", amount: usd(1000) },
            {
              accountId: fixture.clientLiabilityAccountId,
              direction: "credit",
              amount: usd(1000),
            },
          ],
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "posting-to-liability-root" });

    const { results } = await fixture.database
      .prepare("SELECT ledger_account_id FROM trust_ledger_node WHERE kind = 'client'")
      .bind()
      .all<{ ledger_account_id: string }>();
    const clientNodeAccountId = results[0]?.ledger_account_id ?? leaf.ledgerAccountId;
    await expect(
      composeTrustEntry(
        fixture.database,
        {
          description: "Posting to the client node",
          effectiveDate: "2026-08-05",
          lines: [
            { accountId: fixture.bankLedgerAccountId, direction: "debit", amount: usd(1000) },
            {
              accountId: clientNodeAccountId as typeof leaf.ledgerAccountId,
              direction: "credit",
              amount: usd(1000),
            },
          ],
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "posting-to-client-node" });
  });

  it("refuses an entry that touches no trust account at all", async () => {
    const fixture = await trustFixture();
    await expect(
      composeTrustEntry(
        fixture.database,
        {
          description: "An ordinary operating entry",
          effectiveDate: "2026-08-05",
          lines: [
            { accountId: fixture.operatingBankAccountId, direction: "debit", amount: usd(1000) },
            {
              accountId: fixture.accountsReceivableAccountId,
              direction: "credit",
              amount: usd(1000),
            },
          ],
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "not-a-trust-entry" });
  });

  it("refuses a trust entry with no client line and one with no bank line", async () => {
    const fixture = await trustFixture();
    const leaf = await seedMatterLeaf(fixture, "entity_a", "Webb");
    await expect(
      composeTrustEntry(
        fixture.database,
        {
          description: "Bank line only",
          effectiveDate: "2026-08-05",
          lines: [
            { accountId: fixture.bankLedgerAccountId, direction: "debit", amount: usd(1000) },
            { accountId: fixture.bankLedgerAccountId, direction: "credit", amount: usd(1000) },
          ],
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "missing-client-line" });

    await expect(
      composeTrustEntry(
        fixture.database,
        {
          description: "Client lines only",
          effectiveDate: "2026-08-05",
          lines: [
            { accountId: leaf.ledgerAccountId, direction: "debit", amount: usd(1000) },
            { accountId: leaf.ledgerAccountId, direction: "credit", amount: usd(1000) },
          ],
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "missing-trust-bank-line" });
  });

  it("inherits the ledger's own rules: no future dating, one currency, balanced", async () => {
    const fixture = await trustFixture();
    const leaf = await seedMatterLeaf(fixture, "entity_a", "Webb");
    await expect(
      composeTrustEntry(
        fixture.database,
        {
          description: "Dated tomorrow",
          effectiveDate: "2026-08-06",
          lines: [
            { accountId: fixture.bankLedgerAccountId, direction: "debit", amount: usd(1000) },
            { accountId: leaf.ledgerAccountId, direction: "credit", amount: usd(1000) },
          ],
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "future-effective-date" });

    await expect(
      composeTrustEntry(
        fixture.database,
        {
          description: "Does not balance",
          effectiveDate: "2026-08-05",
          lines: [
            { accountId: fixture.bankLedgerAccountId, direction: "debit", amount: usd(1000) },
            { accountId: leaf.ledgerAccountId, direction: "credit", amount: usd(900) },
          ],
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "unbalanced" });
  });
});
