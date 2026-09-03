import { describe, expect, it } from "vitest";
import type { MatterId } from "@magna-carta/identifiers/types";
import {
  readBillingArrangementHistory,
  readBillingArrangementInForce,
  requireArrangementOfKind,
  setBillingArrangement,
  type SetBillingArrangementInput,
} from "../src/arrangements.ts";
import { BillingValidationError } from "../src/billing-validation.ts";
import { billingArrangementOverlapsStatement } from "../src/fitness.ts";
import { billingFixture, commit, expectRefusal, options, seedMatter } from "./support.ts";

const arrangementInput = (
  matterId: MatterId,
  overrides: Partial<SetBillingArrangementInput> = {},
): SetBillingArrangementInput => ({
  matterId,
  kind: "hourly",
  currency: "USD",
  validFrom: "2026-08-01",
  createdBy: null,
  ...overrides,
});

describe("the fee agreement", () => {
  it("records the signed agreement behind a version, and reads its name back beside its id", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, "entity_client", "Signed");
    const fileId = "file_intake0000000000000000000";
    await fixture.database
      .prepare(
        `INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)`,
      )
      .bind(fileId, matterId, "Intake agreement.pdf", "2026-08-01T00:00:00.000Z")
      .run();
    const set = await setBillingArrangement(
      fixture.database,
      arrangementInput(matterId, {
        kind: "flat_fee",
        flatFeeAmountMinor: 500_000,
        agreementFileId: fileId as never,
      }),
      options,
    );
    await commit(fixture.database, set.effect);

    const inForce = await readBillingArrangementInForce(fixture.database, matterId);
    expect(inForce?.agreementFileId).toBe(fileId);
    expect(inForce?.agreementFileName).toBe("Intake agreement.pdf");
  });

  it("holds no agreement by default, and says so with two nulls rather than an empty name", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, "entity_client", "Unsigned");
    const set = await setBillingArrangement(fixture.database, arrangementInput(matterId), options);
    await commit(fixture.database, set.effect);
    const inForce = await readBillingArrangementInForce(fixture.database, matterId);
    expect(inForce?.agreementFileId).toBeNull();
    expect(inForce?.agreementFileName).toBeNull();
  });

  it("refuses a signed agreement that is not a live file, by name, before anything is written", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, "entity_client", "Ghost");
    await expect(
      setBillingArrangement(
        fixture.database,
        arrangementInput(matterId, { agreementFileId: "file_nothere00000000000000000" as never }),
        options,
      ),
    ).rejects.toMatchObject({ code: "billing-arrangement-invalid" });
    expect(await readBillingArrangementInForce(fixture.database, matterId)).toBeUndefined();
  });

  it("records an arrangement and reads it back in force", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, "entity_client", "Flat");
    const set = await setBillingArrangement(
      fixture.database,
      arrangementInput(matterId, { kind: "flat_fee", flatFeeAmountMinor: 500_000 }),
      options,
    );
    await commit(fixture.database, set.effect);

    const inForce = await readBillingArrangementInForce(fixture.database, matterId);
    expect(inForce?.kind).toBe("flat_fee");
    expect(inForce?.flatFeeAmountMinor).toBe(500_000);
    expect(inForce?.version).toBe(1);
    expect(inForce?.validTo).toBeNull();
  });

  it("absence of an arrangement means hourly: the in-force read is empty and requireArrangementOfKind refuses by name", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, "entity_client", "Hourly");
    expect(await readBillingArrangementInForce(fixture.database, matterId)).toBeUndefined();
    await expect(
      requireArrangementOfKind(fixture.database, matterId, "flat_fee"),
    ).rejects.toMatchObject({ code: "billing-arrangement-kind-mismatch" });
  });

  it("an amendment is a NEW version that closes the old one, and the history keeps both", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, "entity_client", "Amended");
    const first = await setBillingArrangement(
      fixture.database,
      arrangementInput(matterId, { kind: "flat_fee", flatFeeAmountMinor: 500_000 }),
      options,
    );
    await commit(fixture.database, first.effect);
    const second = await setBillingArrangement(
      fixture.database,
      arrangementInput(matterId, {
        kind: "contingency",
        contingencyShareE4: 3_333,
        contingencyBasis: "net_after_costs",
        validFrom: "2026-08-05",
      }),
      options,
    );
    await commit(fixture.database, second.effect);

    const history = await readBillingArrangementHistory(fixture.database, matterId);
    expect(history).toHaveLength(2);
    expect(history[0]?.version).toBe(2);
    expect(history[0]?.kind).toBe("contingency");
    expect(history[0]?.validTo).toBeNull();
    // The superseded version STAYS, closed at the amendment's start — the old agreement is part of
    // the record, because invoices reference the version that was in force.
    expect(history[1]?.version).toBe(1);
    expect(history[1]?.kind).toBe("flat_fee");
    expect(history[1]?.validTo).toBe("2026-08-05");

    const inForce = await readBillingArrangementInForce(fixture.database, matterId);
    expect(inForce?.version).toBe(2);
  });

  it("a superseded version is frozen by trigger: any edit beyond the one-time close refuses", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, "entity_client", "Frozen");
    const set = await setBillingArrangement(
      fixture.database,
      arrangementInput(matterId, { kind: "flat_fee", flatFeeAmountMinor: 500_000 }),
      options,
    );
    await commit(fixture.database, set.effect);

    // Editing the amount of the OPEN version is refused: a fee change is a new version.
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(`UPDATE matter_billing_arrangement SET flat_fee_amount_minor = 1 WHERE id = ?1`)
          .bind(set.arrangementId)
          .run(),
      ),
    ).rejects.toThrow(/append-only/);
    // Deleting is refused outright.
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(`DELETE FROM matter_billing_arrangement WHERE id = ?1`)
          .bind(set.arrangementId)
          .run(),
      ),
    ).rejects.toThrow(/append-only/);
  });

  it("a closed version cannot be re-opened or re-closed", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, "entity_client", "Closed");
    const first = await setBillingArrangement(
      fixture.database,
      arrangementInput(matterId, { kind: "hourly" }),
      options,
    );
    await commit(fixture.database, first.effect);
    const second = await setBillingArrangement(
      fixture.database,
      arrangementInput(matterId, { kind: "hourly", validFrom: "2026-08-03" }),
      options,
    );
    await commit(fixture.database, second.effect);
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(`UPDATE matter_billing_arrangement SET valid_to = '2026-09-01' WHERE id = ?1`)
          .bind(first.arrangementId)
          .run(),
      ),
    ).rejects.toThrow(/append-only/);
  });

  it("versions are dense per matter: an insert that skips a version aborts on the trigger", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, "entity_client", "Dense");
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            `INSERT INTO matter_billing_arrangement (id, matter_id, version, kind, currency, valid_from, created_at)
             VALUES ('billingArrangement_skip', ?1, 2, 'hourly', 'USD', '2026-08-01', '2026-08-05T00:00:00.000Z')`,
          )
          .bind(matterId)
          .run(),
      ),
    ).rejects.toThrow(/next version/);
  });

  it("two concurrent amendments converge: the loser aborts rather than interleaving", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, "entity_client", "Race");
    const base = await setBillingArrangement(
      fixture.database,
      arrangementInput(matterId, { kind: "hourly" }),
      options,
    );
    await commit(fixture.database, base.effect);

    // Both composed against the same in-force read, as two requests would be.
    const left = await setBillingArrangement(
      fixture.database,
      arrangementInput(matterId, {
        kind: "flat_fee",
        flatFeeAmountMinor: 500_000,
        validFrom: "2026-08-05",
      }),
      options,
    );
    const right = await setBillingArrangement(
      fixture.database,
      arrangementInput(matterId, {
        kind: "retainer",
        retainerTargetMinor: 1_000_000,
        retainerThresholdMinor: 250_000,
        validFrom: "2026-08-05",
      }),
      options,
    );
    await commit(fixture.database, left.effect);
    await expect(expectRefusal(() => commit(fixture.database, right.effect))).rejects.toThrow();

    const inForce = await readBillingArrangementInForce(fixture.database, matterId);
    expect(inForce?.kind).toBe("flat_fee");
    expect(inForce?.version).toBe(2);
  });

  it("each kind carries exactly its own fields, refused by name before the CHECK can abort on a column", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, "entity_client", "Shape");
    const refusals: readonly Partial<SetBillingArrangementInput>[] = [
      { kind: "flat_fee" }, // missing its amount
      { kind: "flat_fee", flatFeeAmountMinor: 0 },
      { kind: "contingency", contingencyShareE4: 3_333 }, // missing its basis
      { kind: "contingency", contingencyBasis: "gross_recovery" }, // missing its share
      { kind: "contingency", contingencyShareE4: 10_001, contingencyBasis: "gross_recovery" },
      { kind: "retainer", retainerTargetMinor: 1_000_000 }, // missing its floor
      { kind: "retainer", retainerTargetMinor: 1_000_000, retainerThresholdMinor: 2_000_000 },
      { kind: "hourly", flatFeeAmountMinor: 500_000 }, // hourly carries nothing
    ];
    for (const overrides of refusals) {
      await expect(async () =>
        setBillingArrangement(fixture.database, arrangementInput(matterId, overrides), options),
      ).rejects.toThrow(BillingValidationError);
    }
  });

  it("a back-dated amendment is refused: what governed an earlier date is the version in force then", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, "entity_client", "Backdate");
    const first = await setBillingArrangement(
      fixture.database,
      arrangementInput(matterId, { validFrom: "2026-08-05" }),
      options,
    );
    await commit(fixture.database, first.effect);
    await expect(
      setBillingArrangement(
        fixture.database,
        arrangementInput(matterId, { validFrom: "2026-08-01" }),
        options,
      ),
    ).rejects.toMatchObject({ code: "billing-arrangement-invalid" });
  });

  it("the overlap fitness query is empty over a well-formed history", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, "entity_client", "Overlap");
    for (const validFrom of ["2026-08-01", "2026-08-03", "2026-08-06"]) {
      const set = await setBillingArrangement(
        fixture.database,
        arrangementInput(matterId, { validFrom }),
        options,
      );
      await commit(fixture.database, set.effect);
    }
    const { results } = await billingArrangementOverlapsStatement(fixture.database).all();
    expect(results).toHaveLength(0);
  });
});
