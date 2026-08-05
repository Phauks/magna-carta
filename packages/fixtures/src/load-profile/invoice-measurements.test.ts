import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { MatterId, TimeEntryId, UserId } from "@magna-carta/identifiers/types";
import { MAXIMUM_CLAIMS_PER_INVOICE } from "@magna-carta/billing/draft";
import { afterAll, describe, expect, it } from "vitest";
import { fixtureContext, type FixtureContext } from "../context.ts";
import { createLocalPerFirmDatabase, type LocalDatabase } from "../local-database.ts";
import { generateInvoiceVolume, type InvoiceAttachPoints } from "./invoice-generate.ts";
import { invoiceHotPathPlans, INVOICE_PLAN_SCAN_ALLOWLIST } from "./invoice-measurements.ts";
import { ledgerVolume, scaleProfile } from "./profile.ts";
import { findFullScans } from "./runner.ts";

// A CI-smoke-scale invoice volume (the smallest multiplier the floors allow), laid down over a
// handful of real matters at the current per-firm schema through the REAL billing write paths. The
// plan-scan guard then asserts every billing hot read walks an index at volume — with the firm-wide
// aging read the one allow-listed exception, because "what does the whole firm still have
// outstanding" has no narrower answer.
const SMOKE_SEED = "invoice-measurements-smoke";
const SMOKE_PROFILE = scaleProfile(ledgerVolume, 0.01);

// The invoices reference matters and their time entries; the practice and timekeeping generators own
// those in the full snapshot, so this standalone trio seeds its own minimal set — a matter, the
// client party the invoice's client resolves through, and the billable time an invoice draws from.
async function seedBillableMatters(
  database: SqlDatabase,
  context: FixtureContext,
  matterCount: number,
  entriesPerMatter: number,
): Promise<InvoiceAttachPoints> {
  const actorUserId = newIdentifier("user", context.randomSource) as UserId;
  const createdAt = context.clock.now();
  await insertMemberStatement(database, {
    userId: actorUserId,
    displayName: "Load-profile biller",
    now: createdAt,
  }).run();

  const billableMatters: {
    matterId: MatterId;
    clientEntityId: string;
    timeEntryIds: TimeEntryId[];
  }[] = [];
  for (let matterIndex = 0; matterIndex < matterCount; matterIndex += 1) {
    const matterId = newIdentifier("matter", context.randomSource) as MatterId;
    const clientEntityId = `directoryOrganization_client${matterIndex}`;
    await database
      .prepare(
        `INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, ?4, ?4)`,
      )
      .bind(matterId, `Matter ${matterIndex + 1}`, actorUserId, createdAt)
      .run();
    await database
      .prepare(
        `INSERT INTO matter_party (id, matter_id, entity_id, role, created_at, updated_at) VALUES (?1, ?2, ?3, 'client', ?4, ?4)`,
      )
      .bind(newIdentifier("matterParty", context.randomSource), matterId, clientEntityId, createdAt)
      .run();

    const timeEntryIds: TimeEntryId[] = [];
    for (let entryIndex = 0; entryIndex < entriesPerMatter; entryIndex += 1) {
      const timeEntryId = newIdentifier("timeEntry", context.randomSource) as TimeEntryId;
      timeEntryIds.push(timeEntryId);
      await database
        .prepare(
          `INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, currency, rate_e4, amount_minor, status, source, created_at, updated_at)
           VALUES (?1, ?2, ?3, '2026-08-01', 60, 60, ?4, 1, 'USD', 4000000, 40000, 'draft', 'manual', ?5, ?5)`,
        )
        .bind(
          timeEntryId,
          matterId,
          actorUserId,
          `Attended to matter ${matterIndex + 1}, item ${entryIndex + 1}`,
          createdAt,
        )
        .run();
    }
    billableMatters.push({ matterId, clientEntityId, timeEntryIds });
  }
  return { actorUserId, billableMatters };
}

let local: LocalDatabase | undefined;

afterAll(() => {
  local?.raw.close();
});

describe("billing hot reads are index-served at volume", () => {
  it("lays down the invoice volume through the real write paths and plans every hot read", async () => {
    local = createLocalPerFirmDatabase();
    const context = fixtureContext(SMOKE_SEED);
    const volume = SMOKE_PROFILE.invoices;
    const attach = await seedBillableMatters(
      local.database,
      context,
      volume.billedMatterCount,
      volume.invoicesPerBilledMatter * volume.claimsPerInvoice,
    );

    const result = await generateInvoiceVolume(local.database, context, volume, attach, {
      allowSeeding: true,
    });

    // Non-vacuity: real invoices, real lines, real claims, and at least one finalized bill for the
    // detail and aging plans to have a row to walk.
    expect(result.finalizedInvoiceCount).toBeGreaterThan(0);
    expect(result.invoiceLineCount).toBeGreaterThan(0);
    expect(result.claimCount).toBeGreaterThan(0);

    const plans = invoiceHotPathPlans({
      database: local.database,
      raw: local.raw,
      probes: result.probes,
    });
    const scans = findFullScans(plans, INVOICE_PLAN_SCAN_ALLOWLIST);
    expect(scans, scans.join(", ")).toEqual([]);
  });

  it("keeps the claim ceiling inside what one finalize batch can carry", () => {
    // The finalize batch writes roughly two statements per claimed entry (the billed lock and its
    // commit guard) plus one per line, on top of a fixed head of about a dozen: the counter pair,
    // the invoice update, a balance row per matter, and the ledger entry with its lines and balance
    // deltas. The measured shape below is what sets MAXIMUM_CLAIMS_PER_INVOICE rather than a guess,
    // and this assertion is the record of the measurement: at the ceiling the batch stays inside the
    // bound below, and raising the constant without re-measuring fails here.
    const statementsPerClaim = 3; // the claim's line, its billed lock, and its commit-guard share
    const fixedBatchHead = 24;
    const measuredCeilingStatements = 1_250;
    expect(MAXIMUM_CLAIMS_PER_INVOICE * statementsPerClaim + fixedBatchHead).toBeLessThanOrEqual(
      measuredCeilingStatements,
    );
  });
});
