import { createOrganization } from "@magna-carta/directory/organization";
import { createPerson } from "@magna-carta/directory/person";
import { setEntityReferral } from "@magna-carta/directory/referrals";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { fromMinor, toMinor } from "@magna-carta/money/format";
import { sum, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { assembleRevenue } from "../src/financial/revenue.ts";
import { assembleWorkByReferrer } from "../src/financial/work-by-referrer.ts";
import { reportingFixture, seedMatter, type ReportingFixture } from "./support.ts";

// WORK BY REFERRER. The money is Revenue's for the same period and knowledge instant, grouped by how
// each bill's client found the firm: by source, then by the person who referred them, with clients
// who have a referrer and no source, and clients with nothing recorded, in groups of their own. Every
// level adds up to the totals, and the totals are Revenue's.

const COMPUTED_AT = "2026-08-05T15:00:00.000Z";
const JULY = { periodStart: "2026-07-01", periodEnd: "2026-07-31" };
const ANOTHER_ATTORNEY = "directoryReferralSource_anotherAttorney000000";
const WEBSITE = "directoryReferralSource_website00000000000000";
const totalOf = (minors: readonly number[]): number =>
  minors.length === 0 ? 0 : toMinor(sum(minors.map((minor) => fromMinor(minor, USD))));

function writeOptions(seed: string) {
  return {
    clock: { now: () => "2026-06-01T09:00:00.000Z" },
    actorUserId: "user_actor" as UserId,
    randomSource: seededRandomSource(seed),
  };
}

async function bill(
  fixture: ReportingFixture,
  client: string,
  matters: readonly { readonly matterId: string; readonly totalMinor: number }[],
  issueDate: string,
): Promise<string> {
  const invoiceId = newIdentifier("invoice");
  const at = `${issueDate}T09:00:00.000Z`;
  await fixture.database
    .prepare(
      "INSERT INTO invoice (id, client_entity_id, currency, status, invoice_number, number_scope_key, number_drawn_value, issue_date, due_date, finalized_at, created_at, updated_at) VALUES (?1, ?2, 'USD', 'final', ?3, '', 1, ?5, ?5, ?4, ?4, ?4)",
    )
    .bind(invoiceId, client, invoiceId.slice(-6), at, issueDate)
    .run();
  for (const matter of matters) {
    await fixture.database
      .prepare(
        "INSERT INTO invoice_matter_balance (invoice_id, matter_id, total_minor, applied_minor, currency, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 'USD', ?4, ?4)",
      )
      .bind(invoiceId, matter.matterId, matter.totalMinor, at)
      .run();
  }
  return invoiceId;
}

async function pay(
  fixture: ReportingFixture,
  invoiceId: string,
  matterId: string,
  amountMinor: number,
  effectiveDate: string,
): Promise<void> {
  const entryId = newIdentifier("ledgerEntry");
  const at = `${effectiveDate}T12:00:00.000Z`;
  await fixture.database
    .prepare(
      "INSERT INTO ledger_entry (id, description, effective_date, recorded_at) VALUES (?1, 'Application', ?2, ?3)",
    )
    .bind(entryId, effectiveDate, at)
    .run();
  await fixture.database
    .prepare(
      "INSERT INTO invoice_application (id, invoice_id, matter_id, kind, amount_minor, currency, entry_id, effective_date, applied_at, reverses_application_id, reason) VALUES (?1, ?2, ?3, 'payment', ?4, 'USD', ?5, ?6, ?7, NULL, NULL)",
    )
    .bind(
      newIdentifier("invoiceApplication"),
      invoiceId,
      matterId,
      amountMinor,
      entryId,
      effectiveDate,
      at,
    )
    .run();
}

async function book() {
  const fixture = await reportingFixture();
  const database = fixture.database;
  const at = "2026-06-01T09:00:00.000Z";
  const referrer = await createPerson(
    database,
    { given: "Daniel", family: "Okafor" },
    writeOptions("referrer"),
  );
  const margaret = await createPerson(
    database,
    { given: "Margaret", family: "Ellison" },
    writeOptions("margaret"),
  );
  const harbor = await createOrganization(
    database,
    { legalName: "Harbor Supply Co." },
    writeOptions("harbor"),
  );
  const priya = await createPerson(
    database,
    { given: "Priya", family: "Raman" },
    writeOptions("priya"),
  );
  const unrecorded = await createPerson(
    database,
    { given: "Tomas", family: "Lindqvist" },
    writeOptions("unrecorded"),
  );

  // Margaret and Harbor were both sent by Daniel Okafor, another attorney; Priya found the website;
  // Tomas's referral was never recorded. Harbor's second referral row names a person and no source.
  await setEntityReferral(
    database,
    margaret,
    { sourceId: ANOTHER_ATTORNEY, referrerEntityId: referrer },
    writeOptions("margaret-referral"),
  );
  await setEntityReferral(
    database,
    harbor,
    { sourceId: null, referrerEntityId: referrer },
    writeOptions("harbor-referral"),
  );
  await setEntityReferral(
    database,
    priya,
    { sourceId: WEBSITE, referrerEntityId: null },
    writeOptions("priya-referral"),
  );

  const margaretOne = await seedMatter(fixture, "Ellison estate", margaret, at);
  const margaretTwo = await seedMatter(fixture, "Ellison lease", margaret, at);
  const harborMatter = await seedMatter(fixture, "Harbor contract", harbor, at);
  const priyaMatter = await seedMatter(fixture, "Raman custody", priya, at);
  const tomasMatter = await seedMatter(fixture, "Lindqvist claim", unrecorded, at);

  const margaretBill = await bill(
    fixture,
    margaret,
    [
      { matterId: margaretOne, totalMinor: 60_000 },
      { matterId: margaretTwo, totalMinor: 20_000 },
    ],
    "2026-07-10",
  );
  await bill(fixture, harbor, [{ matterId: harborMatter, totalMinor: 15_000 }], "2026-07-11");
  const priyaBill = await bill(
    fixture,
    priya,
    [{ matterId: priyaMatter, totalMinor: 30_000 }],
    "2026-07-12",
  );
  await bill(fixture, unrecorded, [{ matterId: tomasMatter, totalMinor: 5_000 }], "2026-07-13");
  await pay(fixture, margaretBill, margaretOne, 25_000, "2026-07-20");
  await pay(fixture, priyaBill, priyaMatter, 10_000, "2026-07-21");
  // After the period: in no July figure.
  await pay(fixture, priyaBill, priyaMatter, 5_000, "2026-08-02");
  return { fixture, referrer };
}

describe("the work by referrer report", () => {
  it("totals what Revenue totals for the same period", async () => {
    const { fixture } = await book();
    for (const knownAsOf of [null, "2026-07-14T23:00:00.000Z"]) {
      const input = { ...JULY, knownAsOf, locationId: null };
      const revenue = await assembleRevenue(fixture.database, input, { computedAt: COMPUTED_AT });
      const report = await assembleWorkByReferrer(fixture.database, input, {
        computedAt: COMPUTED_AT,
      });
      expect(report.totals).toEqual(revenue.totals);
      expect(report.reproducibility).toEqual(revenue.reproducibility);
      for (const field of ["billedMinor", "collectedMinor", "creditedMinor"] as const) {
        expect(totalOf(report.sources.map((row) => row.figures[field]))).toBe(report.totals[field]);
        for (const source of report.sources) {
          if (source.kind === "notRecorded") continue;
          expect(totalOf(source.referrers.map((row) => row.figures[field]))).toBe(
            source.figures[field],
          );
        }
      }
    }
  });

  it("groups by source, then by the person who referred, with the unrecorded last", async () => {
    const { fixture, referrer } = await book();
    const report = await assembleWorkByReferrer(
      fixture.database,
      { ...JULY, knownAsOf: null, locationId: null },
      { computedAt: COMPUTED_AT },
    );
    expect(report.totals).toEqual({
      billedMinor: 130_000,
      collectedMinor: 35_000,
      creditedMinor: 0,
    });
    expect(
      report.sources.map((row) => [
        row.kind,
        row.sourceName,
        row.clientCount,
        row.matterCount,
        row.figures.billedMinor,
        row.figures.collectedMinor,
      ]),
    ).toEqual([
      ["source", "Another Attorney", 1, 2, 80_000, 25_000],
      ["source", "Website", 1, 1, 30_000, 10_000],
      ["referrerOnly", null, 1, 1, 15_000, 0],
      ["notRecorded", null, 1, 1, 5_000, 0],
    ]);
    expect(report.sources[0]?.referrers).toEqual([
      {
        referrerEntityId: referrer,
        referrerName: "Daniel Okafor",
        clientCount: 1,
        matterCount: 2,
        figures: { billedMinor: 80_000, collectedMinor: 25_000, creditedMinor: 0 },
      },
    ]);
    // A source with no person recorded lists its clients under a row with no referrer.
    expect(report.sources[1]?.referrers.map((row) => row.referrerEntityId)).toEqual([null]);
    expect(report.sources[2]?.referrers.map((row) => row.referrerName)).toEqual(["Daniel Okafor"]);
    expect(report.sources[3]?.referrers).toEqual([]);
  });
});
