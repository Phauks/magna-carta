import { readMatterRegister } from "@magna-carta/matters/matter-register";
import { describe, expect, it } from "vitest";
import { assembleMattersList } from "../src/operational/matters-list.ts";
import { reportingFixture, seedMatter } from "./support.ts";

// THE MATTERS LIST. The rows are the matters package's own read; the report lists every one and
// counts them per office, and every office's counts must add up to the whole.

const COMPUTED_AT = "2026-08-05T15:00:00.000Z";

async function book() {
  const fixture = await reportingFixture();
  const at = "2026-02-01T09:00:00.000Z";
  const alder = await seedMatter(fixture, "Alder", "entity_alder", at);
  const washoe = await seedMatter(fixture, "Washoe", "entity_washoe", at);
  const elko = await seedMatter(fixture, "Elko", "entity_elko", at);
  const enquiry = await seedMatter(fixture, "Enquiry", "entity_elko", at);
  await fixture.database.batch([
    fixture.database
      .prepare(
        "UPDATE matter SET location_id = ?1, opened_at = ?2, matter_number = '0001' WHERE id = ?3",
      )
      .bind(fixture.locationId, at, alder),
    fixture.database
      .prepare(
        "UPDATE matter SET status = 'closed', opened_at = ?1, closed_at = ?2, matter_number = '0002' WHERE id = ?3",
      )
      .bind(at, "2026-07-01T09:00:00.000Z", washoe),
    fixture.database
      .prepare(
        "UPDATE matter SET status = 'hold', hold_reason = 'Client travelling', held_at = ?1, opened_at = ?1, matter_number = '0003' WHERE id = ?2",
      )
      .bind(at, elko),
    // An enquiry is not a matter yet, and the list leaves it out.
    fixture.database.prepare("UPDATE matter SET status = 'intake' WHERE id = ?1").bind(enquiry),
  ]);
  return { fixture, alder, washoe, elko };
}

describe("the matters list", () => {
  it("lists every opened matter and counts them per office, adding up to the whole", async () => {
    const { fixture, alder, washoe, elko } = await book();
    const report = await assembleMattersList(
      fixture.database,
      { locationId: null },
      { computedAt: COMPUTED_AT },
    );
    const register = await readMatterRegister(fixture.database, { locationId: null });

    expect(report.matters).toEqual(register.rows);
    expect(report.matters.map((matter) => matter.matterId)).toEqual([alder, washoe, elko]);
    expect(report.totals).toEqual({ matterCount: 3, openCount: 1, heldCount: 1, closedCount: 1 });
    const summed = report.offices.reduce((whole, office) => whole + office.counts.matterCount, 0);
    expect(summed).toBe(report.totals.matterCount);
    expect(report.matters[1]).toMatchObject({
      status: "closed",
      clientEntityId: "entity_washoe",
      responsibleName: "Responsible Attorney",
      closedAt: "2026-07-01T09:00:00.000Z",
    });
  });

  it("narrows to one office", async () => {
    const { fixture, alder } = await book();
    const report = await assembleMattersList(
      fixture.database,
      { locationId: fixture.locationId },
      { computedAt: COMPUTED_AT },
    );
    expect(report.matters.map((matter) => matter.matterId)).toEqual([alder]);
    expect(report.offices).toEqual([
      { locationId: fixture.locationId, locationName: "Reno", counts: report.totals },
    ]);
  });
});
