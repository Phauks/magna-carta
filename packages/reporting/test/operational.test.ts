import { newIdentifier } from "@magna-carta/identifiers/generate";
import { describe, expect, it } from "vitest";
import { assembleOperationalVolumes } from "../src/operational/operational-volumes.ts";
import { depositInto, reportingFixture, seedMatter } from "./support.ts";

// THE OPERATIONAL VOLUMES. Each domain counts its own records; this proves the report places them
// side by side, honors the knowledge instant on the sections that can, and names the ones that cannot.

const COMPUTED_AT = "2026-08-05T15:00:00.000Z";

async function book() {
  const fixture = await reportingFixture();
  const webb = await seedMatter(fixture, "Webb", "entity_webb", "2026-07-01T09:00:00.000Z");
  await fixture.database
    .prepare("UPDATE matter SET opened_at = ?1, location_id = ?2 WHERE id = ?3")
    .bind("2026-07-02T09:00:00.000Z", fixture.locationId, webb)
    .run();
  await depositInto(fixture, {
    matterId: webb,
    label: "Webb",
    amountMinor: 500_00,
    effectiveDate: "2026-07-05",
    recordedAt: "2026-07-05T10:00:00.000Z",
  });
  // A deposit recorded in August and backdated into July.
  await depositInto(fixture, {
    matterId: webb,
    label: "Webb",
    amountMinor: 200_00,
    effectiveDate: "2026-07-20",
    recordedAt: "2026-08-02T10:00:00.000Z",
  });
  const invoiceId = newIdentifier("invoice");
  await fixture.database
    .prepare(
      "INSERT INTO invoice (id, client_entity_id, currency, status, invoice_number, number_scope_key, number_drawn_value, issue_date, due_date, finalized_at, location_id, created_at, updated_at) VALUES (?1, 'entity_webb', 'USD', 'final', ?2, '', 1, '2026-07-10', '2026-08-10', ?3, ?4, ?3, ?3)",
    )
    .bind(invoiceId, invoiceId.slice(-6), "2026-07-10T09:00:00.000Z", fixture.locationId)
    .run();
  await fixture.database
    .prepare(
      `INSERT INTO cost_entry (id, matter_id, incurred_date, amount_minor, currency, disbursement_class, billable, description, status, source, created_at, updated_at)
       VALUES (?1, ?2, '2026-07-08', 12500, 'USD', 'hard', 1, 'Filing fee', 'draft', 'manual', ?3, ?3)`,
    )
    .bind(newIdentifier("costEntry"), webb, COMPUTED_AT)
    .run();
  return fixture;
}

describe("the operational volumes report", () => {
  it("counts what the firm did in the period, from each domain's own records", async () => {
    const fixture = await book();
    const report = await assembleOperationalVolumes(
      fixture.database,
      { periodStart: "2026-07-01", periodEnd: "2026-07-31", knownAsOf: null, locationId: null },
      { computedAt: COMPUTED_AT },
    );
    expect(report.matters).toEqual([
      { measure: "opened", matterTypeId: null, matterTypeName: null, count: 1 },
    ]);
    expect(report.billing).toMatchObject({ billsFinalized: 1, billsDrafted: 1 });
    expect(
      report.trust.filter((row) => row.measure === "movement").map((row) => row.count),
    ).toEqual([2]);
    expect(report.costs).toEqual([{ disbursementClass: "hard", count: 1 }]);
    expect(report.liveSections).toEqual(["matters", "costs"]);
  });

  it("leaves a backdated movement out of the count taken as at an earlier instant", async () => {
    const fixture = await book();
    const report = await assembleOperationalVolumes(
      fixture.database,
      {
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        knownAsOf: "2026-07-31T23:59:59.999Z",
        locationId: null,
      },
      { computedAt: COMPUTED_AT },
    );
    expect(
      report.trust.filter((row) => row.measure === "movement").map((row) => row.count),
    ).toEqual([1]);
    expect(report.reproducibility.reproducible).toBe(true);
  });

  it("narrows every section to one office", async () => {
    const fixture = await book();
    const report = await assembleOperationalVolumes(
      fixture.database,
      {
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        knownAsOf: null,
        locationId: "location_elsewhere",
      },
      { computedAt: COMPUTED_AT },
    );
    expect(report.matters).toEqual([]);
    expect(report.billing.billsFinalized).toBe(0);
    expect(report.trust).toEqual([]);
    expect(report.costs).toEqual([]);
  });
});
