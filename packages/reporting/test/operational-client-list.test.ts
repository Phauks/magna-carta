import { newIdentifier } from "@magna-carta/identifiers/generate";
import { describe, expect, it } from "vitest";
import { assembleClientList } from "../src/operational/client-list.ts";
import { assembleMattersList } from "../src/operational/matters-list.ts";
import { reportingFixture, seedMatter, type ReportingFixture } from "./support.ts";

// THE CLIENT LIST. Who is a client is the matters package's register; what each is called and how
// to reach them is the directory's own listing row. The clients' matter counts must add up to the
// Matters List's totals, less the matters with no client.

const COMPUTED_AT = "2026-08-05T15:00:00.000Z";
const AT = "2026-02-01T09:00:00.000Z";

async function organization(fixture: ReportingFixture, name: string): Promise<string> {
  const id = newIdentifier("directoryOrganization");
  await fixture.database
    .prepare(
      "INSERT INTO directory_organization (id, display_name, legal_name, created_at, updated_at) VALUES (?1, ?2, ?2, ?3, ?3)",
    )
    .bind(id, name, AT)
    .run();
  return id;
}

async function person(fixture: ReportingFixture, given: string, family: string): Promise<string> {
  const id = newIdentifier("directoryPerson");
  await fixture.database
    .prepare(
      "INSERT INTO directory_person (id, name_given, name_family, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
    )
    .bind(id, given, family, AT)
    .run();
  return id;
}

async function book() {
  const fixture = await reportingFixture();
  const zephyr = await organization(fixture, "Zephyr Holdings");
  const alder = await person(fixture, "Ada", "Alder");
  await fixture.database
    .prepare(
      "INSERT INTO directory_email (id, entity_id, address, is_primary, created_at, updated_at) VALUES (?1, ?2, 'ada@example.com', 1, ?3, ?3)",
    )
    .bind(newIdentifier("directoryEmail"), alder, AT)
    .run();
  const alderOne = await seedMatter(fixture, "Alder one", alder, AT);
  const alderTwo = await seedMatter(fixture, "Alder two", alder, AT);
  const zephyrMatter = await seedMatter(fixture, "Zephyr", zephyr, AT);
  // A client the directory no longer holds keeps its row and its count.
  await seedMatter(fixture, "Gone", "directoryPerson_gone", AT);
  const noClient = await seedMatter(fixture, "No client", alder, AT);
  await fixture.database.batch([
    fixture.database
      .prepare("UPDATE matter SET status = 'closed', closed_at = ?1 WHERE id = ?2")
      .bind(AT, alderTwo),
    fixture.database
      .prepare("UPDATE matter SET location_id = ?1 WHERE id = ?2")
      .bind(fixture.locationId, zephyrMatter),
    fixture.database.prepare("DELETE FROM matter_party WHERE matter_id = ?1").bind(noClient),
  ]);
  return { fixture, alder, zephyr, alderOne };
}

describe("the client list", () => {
  it("lists each client once with the directory's contact details, its counts adding up to the Matters List", async () => {
    const { fixture, alder, zephyr } = await book();
    const options = { computedAt: COMPUTED_AT };
    const report = await assembleClientList(fixture.database, { locationId: null }, options);
    const matters = await assembleMattersList(fixture.database, { locationId: null }, options);

    expect(report.mattersWithoutClient).toBe(1);
    expect(report.totals.matterCount + report.mattersWithoutClient).toBe(
      matters.totals.matterCount,
    );
    const summed = report.clients.reduce((whole, client) => whole + client.counts.matterCount, 0);
    expect(summed).toBe(report.totals.matterCount);

    expect(report.clientCount).toBe(3);
    expect(report.clients.map((client) => client.clientEntityId)).toEqual([
      alder,
      zephyr,
      "directoryPerson_gone",
    ]);
    expect(report.clients[0]).toMatchObject({
      entityKind: "person",
      displayName: "Ada Alder",
      emailAddress: "ada@example.com",
      counts: { matterCount: 2, openCount: 1, closedCount: 1 },
    });
    expect(report.clients[1]).toMatchObject({
      entityKind: "organization",
      locationNames: ["Reno"],
    });
    expect(report.clients[2]).toMatchObject({ entityKind: null, displayName: null });
  });

  it("narrows to one office", async () => {
    const { fixture, zephyr } = await book();
    const report = await assembleClientList(
      fixture.database,
      { locationId: fixture.locationId },
      { computedAt: COMPUTED_AT },
    );
    expect(report.clients.map((client) => client.clientEntityId)).toEqual([zephyr]);
  });
});
