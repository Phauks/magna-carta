import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { createPerson, updatePerson } from "@magna-carta/directory/person";
import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { assembleChangeLog, CHANGE_LOG_EVENTS } from "../src/operational/change-log.ts";
import { ReportingValidationError } from "../src/reporting-validation.ts";
import {
  AUTHORIZER,
  clockAt,
  RECORDER,
  reportingFixture,
  type ReportingFixture,
} from "./support.ts";

// THE CHANGE LOG. Its figures are counts of the audit log's own rows: the families and the people
// must each add up to the number of audit rows in the period for the covered events, and the list
// must hold every one of them. Rows outside the period, rows for other events (a file rescan, a
// sealed identifier read) and rows recorded after the report was produced are not counted.

const COMPUTED_AT = "2026-08-05T15:00:00.000Z";

async function audit(
  fixture: ReportingFixture,
  event: string,
  subjectId: string,
  actorUserId: UserId | null,
  at: string,
  metadata?: unknown,
): Promise<void> {
  await domainAuditStatement(fixture.database, {
    event,
    subjectId,
    actorUserId,
    clock: clockAt(at),
    metadata,
  }).run();
}

async function book() {
  const fixture = await reportingFixture();
  // Through the directory's own write paths, so the events are the ones a person really records.
  const personId = await createPerson(
    fixture.database,
    { given: "Avery", family: "Lindqvist" },
    { clock: clockAt("2026-07-02T10:00:00.000Z"), actorUserId: RECORDER },
  );
  await updatePerson(
    fixture.database,
    personId,
    { status: "active" },
    { clock: clockAt("2026-07-03T10:00:00.000Z"), actorUserId: RECORDER },
  );
  await audit(fixture, "matter.created", "matter_one", AUTHORIZER, "2026-07-01T00:00:00.000Z");
  await audit(
    fixture,
    "matter.client_linked",
    "matter_one",
    AUTHORIZER,
    "2026-07-04T08:00:00.000Z",
    {
      entityId: personId,
    },
  );
  await audit(fixture, "matter.closed", "matter_one", RECORDER, "2026-07-31T23:59:59.999Z");
  await audit(
    fixture,
    "trust.authorization_policy_changed",
    "trustAuthorizationPolicy_one",
    AUTHORIZER,
    "2026-07-10T12:00:00.000Z",
  );
  // A system change: no person made it.
  await audit(fixture, "matter.updated", "matter_one", null, "2026-07-11T12:00:00.000Z");
  // Not counted: other events, and changes either side of the period.
  await audit(
    fixture,
    "matter.files_rescan_requested",
    "matter_one",
    RECORDER,
    "2026-07-12T00:00:00.000Z",
  );
  await audit(
    fixture,
    "protected.decrypt",
    "directoryIdentifier_one",
    RECORDER,
    "2026-07-12T00:00:00.000Z",
    {
      table: "directory_identifier",
      field: "value_ciphertext",
    },
  );
  await audit(fixture, "matter.updated", "matter_one", RECORDER, "2026-06-30T23:59:59.999Z");
  await audit(fixture, "matter.updated", "matter_one", RECORDER, "2026-08-01T00:00:00.000Z");
  return fixture;
}

const JULY = { periodStart: "2026-07-01", periodEnd: "2026-07-31" };
const COVERED = Object.keys(CHANGE_LOG_EVENTS);

async function auditRowsIn(
  fixture: ReportingFixture,
  from: string,
  before: string,
  knownAtOrBefore: string,
): Promise<number> {
  const placeholders = COVERED.map((_, index) => `?${String(index + 4)}`).join(", ");
  const { results } = await fixture.database
    .prepare(
      `SELECT COUNT(*) AS count FROM audit_log WHERE created_at >= ?1 AND created_at < ?2 AND created_at <= ?3 AND event IN (${placeholders})`,
    )
    .bind(from, before, knownAtOrBefore, ...COVERED)
    .all<{ count: number }>();
  return results[0]?.count ?? 0;
}

describe("the change log report", () => {
  it("counts every covered change in the period, and the families and the people add up to the audit rows", async () => {
    const fixture = await book();
    const report = await assembleChangeLog(fixture.database, JULY, { computedAt: COMPUTED_AT });
    const auditRows = await auditRowsIn(
      fixture,
      "2026-07-01T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
      COMPUTED_AT,
    );

    expect(auditRows).toBe(7);
    expect(report.totals).toEqual({
      directoryCount: 2,
      matterCount: 4,
      accountCount: 1,
      totalCount: 7,
    });
    expect(report.totals.totalCount).toBe(auditRows);
    expect(report.families.reduce((sum, family) => sum + family.changeCount, 0)).toBe(auditRows);
    expect(report.people.reduce((sum, person) => sum + person.totalCount, 0)).toBe(auditRows);
    for (const person of report.people) {
      expect(person.directoryCount + person.matterCount + person.accountCount).toBe(
        person.totalCount,
      );
    }
    expect(report.entries).toHaveLength(auditRows);
    expect(report.reproducible).toBe(true);
  });

  it("names each person by the member mirror, most changes first, the system last", async () => {
    const fixture = await book();
    const report = await assembleChangeLog(fixture.database, JULY, { computedAt: COMPUTED_AT });
    expect(
      report.people.map((person) => [person.actorName, person.totalCount, person.actorUserId]),
    ).toEqual([
      ["Recording Member", 3, RECORDER],
      ["Responsible Attorney", 3, AUTHORIZER],
      [null, 1, null],
    ]);
  });

  it("lists the changes newest first with a label and the record's handle, never the metadata", async () => {
    const fixture = await book();
    const report = await assembleChangeLog(fixture.database, JULY, { computedAt: COMPUTED_AT });
    expect(report.entries[0]).toMatchObject({
      event: "matter.closed",
      eventLabel: "Matter closed",
      family: "matters",
      subjectId: "matter_one",
      actorName: "Recording Member",
      at: "2026-07-31T23:59:59.999Z",
    });
    expect(report.entries.at(-1)?.event).toBe("matter.created");
    const ats = report.entries.map((entry) => entry.at);
    expect(ats.toSorted().toReversed()).toEqual(ats);
    expect(JSON.stringify(report)).not.toContain("entityId");
    expect(JSON.stringify(report)).not.toContain("value_ciphertext");
  });

  it("does not count a change recorded after it was produced, and says a running period may grow", async () => {
    const fixture = await book();
    const report = await assembleChangeLog(
      fixture.database,
      { periodStart: "2026-07-01", periodEnd: "2026-08-31" },
      { computedAt: "2026-07-20T00:00:00.000Z" },
    );
    expect(report.totals.totalCount).toBe(
      await auditRowsIn(
        fixture,
        "2026-07-01T00:00:00.000Z",
        "2026-09-01T00:00:00.000Z",
        "2026-07-20T00:00:00.000Z",
      ),
    );
    expect(report.entries.some((entry) => entry.at > "2026-07-20T00:00:00.000Z")).toBe(false);
    expect(report.reproducible).toBe(false);
    expect(report.statement).toContain("had not ended");
  });

  it("refuses an inverted period by name", async () => {
    const fixture = await reportingFixture();
    await expect(
      assembleChangeLog(
        fixture.database,
        { periodStart: "2026-07-31", periodEnd: "2026-07-01" },
        { computedAt: COMPUTED_AT },
      ),
    ).rejects.toBeInstanceOf(ReportingValidationError);
  });

  // The vocabulary is a list of strings; a renamed event would silently drop out of the report. Each
  // one must still be written somewhere in the package that owns it.
  it("covers only events the directory, matters and trust packages really write", () => {
    const packagesRoot = join(import.meta.dirname, "..", "..");
    const sourcesOf = (name: string): string => {
      const root = join(packagesRoot, name, "src");
      const walk = (directory: string): string[] =>
        readdirSync(directory).flatMap((entry) => {
          const path = join(directory, entry);
          if (statSync(path).isDirectory()) return walk(path);
          return path.endsWith(".ts") ? [readFileSync(path, "utf8")] : [];
        });
      return walk(root).join("\n");
    };
    const written = ["directory", "matters", "trust"].map(sourcesOf).join("\n");
    const missing = COVERED.filter((event) => !written.includes(`"${event}"`));
    expect(missing).toEqual([]);
  });
});
