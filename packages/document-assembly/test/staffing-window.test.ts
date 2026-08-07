import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { MatterId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  selectMatterStaffingForMergeStatement,
  type MatterStaffingMergeColumns,
} from "../src/merge-statements.ts";

// The staffing read's validity window, against the real schema and real SQLite comparisons. The
// column holds two forms: a bound recorded at creation is a CIVIL DATE (YYYY-MM-DD) inclusive of
// its whole day, and a valid_to stamped by the end-assignment path is the ending INSTANT,
// exclusive from that moment. The property that must never regress is final-day inclusion — an
// assignment "through 2026-08-07" still staffs the matter at 23:59 that day, where a bare
// lexicographic compare of date against instant would have dropped the whole day.

const MATTER_ID = "matter_windowtest000000" as MatterId;
const RESPONSIBLE_ID = "user_windowresponsible0";

function freshDatabase() {
  return createMigratedNodeDatabase("per-firm").database;
}

type Database = ReturnType<typeof freshDatabase>;

async function seed(database: Database): Promise<void> {
  const t = "2026-01-01T00:00:00.000Z";
  for (const [userId, name] of [
    [RESPONSIBLE_ID, "Rowan Ashcroft"],
    ["user_windowmember00000a", "Devon Marchetti"],
  ] as const) {
    await database
      .prepare(
        "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, ?2, 'active', ?3)",
      )
      .bind(userId, name, t)
      .run();
  }
  await database
    .prepare(
      "INSERT INTO matter (id, title, description, status, matter_type_id, location_id, responsible_member_id, client_display_name, client_code, matter_number, numbered_at, opened_at, closed_at, created_at, updated_at) VALUES (?1,'T',NULL,'open',NULL,NULL,?2,NULL,NULL,NULL,NULL,NULL,NULL,?3,?3)",
    )
    .bind(MATTER_ID, RESPONSIBLE_ID, t)
    .run();
}

async function seedAssignment(
  database: Database,
  id: string,
  window: { validFrom?: string | null; validTo?: string | null },
): Promise<void> {
  await database
    .prepare(
      "INSERT INTO matter_assignment (id, matter_id, member_user_id, assignment_role, valid_from, valid_to, created_at, updated_at) VALUES (?1, ?2, 'user_windowmember00000a', 'supervising_attorney', ?3, ?4, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')",
    )
    .bind(id, MATTER_ID, window.validFrom ?? null, window.validTo ?? null)
    .run();
}

async function assignmentRolesAt(database: Database, asOfInstant: string): Promise<string[]> {
  const { results } = await selectMatterStaffingForMergeStatement(
    database,
    MATTER_ID,
    asOfInstant,
  ).all<MatterStaffingMergeColumns>();
  return results.map((row) => row.role).filter((role) => role !== "responsibleAttorney");
}

describe("the staffing read's validity window", () => {
  it("includes a civil-date valid_to for the WHOLE of its final day, and excludes the next", async () => {
    const database = freshDatabase();
    await seed(database);
    await seedAssignment(database, "matterAssignment_wind1", {
      validFrom: "2026-08-01",
      validTo: "2026-08-07",
    });
    expect(await assignmentRolesAt(database, "2026-08-07T00:00:00.000Z")).toHaveLength(1);
    expect(await assignmentRolesAt(database, "2026-08-07T23:59:59.999Z")).toHaveLength(1);
    expect(await assignmentRolesAt(database, "2026-08-08T00:00:00.000Z")).toHaveLength(0);
  });

  it("includes a civil-date valid_from from the start of its day, and excludes the day before", async () => {
    const database = freshDatabase();
    await seed(database);
    await seedAssignment(database, "matterAssignment_wind2", { validFrom: "2026-08-01" });
    expect(await assignmentRolesAt(database, "2026-07-31T23:59:59.999Z")).toHaveLength(0);
    expect(await assignmentRolesAt(database, "2026-08-01T00:00:00.000Z")).toHaveLength(1);
  });

  it("treats an instant-stamped valid_to (the end-assignment form) as exclusive from that moment", async () => {
    const database = freshDatabase();
    await seed(database);
    await seedAssignment(database, "matterAssignment_wind3", {
      validTo: "2026-08-07T12:00:00.000Z",
    });
    expect(await assignmentRolesAt(database, "2026-08-07T11:59:59.999Z")).toHaveLength(1);
    expect(await assignmentRolesAt(database, "2026-08-07T12:00:00.000Z")).toHaveLength(0);
  });

  it("keeps an open-ended assignment current at any instant", async () => {
    const database = freshDatabase();
    await seed(database);
    await seedAssignment(database, "matterAssignment_wind4", {});
    expect(await assignmentRolesAt(database, "2031-01-01T00:00:00.000Z")).toHaveLength(1);
  });
});
