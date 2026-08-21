import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  composeCreateMatterAssignment,
  composeEndMatterAssignment,
  listMatterAssignments,
} from "../src/matter-assignment.ts";
import { MatterValidationError } from "../src/validation.ts";

// The staffing write path's validity window. A bound recorded at creation is a CIVIL DATE
// (YYYY-MM-DD): the staffing read compares these strings lexicographically against an instant, so
// an arbitrary string would not error — it would silently mis-window who a document names. The
// format and the window's ordering are therefore refused at composition, before any statement is
// built.

const MEMBER_ID = "user_assignmenttest0000" as UserId;
const MATTER_ID = "matter_assignmenttest00" as MatterId;

function freshDatabase() {
  return createMigratedNodeDatabase("per-firm").database;
}

type Database = ReturnType<typeof freshDatabase>;

async function seed(database: Database): Promise<void> {
  const t = "2026-01-01T00:00:00.000Z";
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'M', 'active', ?2)",
    )
    .bind(MEMBER_ID, t)
    .run();
  await database
    .prepare(
      "INSERT INTO matter (id, title, description, status, matter_type_id, location_id, responsible_member_id, client_display_name, client_code, matter_number, numbered_at, opened_at, closed_at, created_at, updated_at) VALUES (?1,'T',NULL,'open',NULL,NULL,?2,NULL,NULL,NULL,NULL,NULL,NULL,?3,?3)",
    )
    .bind(MATTER_ID, MEMBER_ID, t)
    .run();
}

const context = { clock: { now: () => "2026-08-07T12:00:00.000Z" }, actorUserId: null };

async function compose(
  database: Database,
  window: { validFrom?: string | null; validTo?: string | null },
) {
  return composeCreateMatterAssignment(
    database,
    {
      matterId: MATTER_ID,
      memberUserId: MEMBER_ID,
      assignmentRole: "supervising_attorney",
      ...window,
    },
    context,
  );
}

async function refusalOf(promise: Promise<unknown>): Promise<MatterValidationError> {
  try {
    await promise;
  } catch (caught) {
    expect(caught).toBeInstanceOf(MatterValidationError);
    return caught as MatterValidationError;
  }
  throw new Error("expected a MatterValidationError refusal");
}

describe("the validity window at composition", () => {
  it("refuses a bound that is not a civil date, naming the code", async () => {
    const database = freshDatabase();
    await seed(database);
    for (const garbage of [
      "next Tuesday",
      "2026-08-07T12:00:00.000Z",
      "08/07/2026",
      "2026-8-7",
      "",
    ]) {
      const fromRefusal = await refusalOf(compose(database, { validFrom: garbage }));
      expect(fromRefusal.code).toBe("invalid-validity-window");
      const toRefusal = await refusalOf(compose(database, { validTo: garbage }));
      expect(toRefusal.code).toBe("invalid-validity-window");
    }
  });

  it("refuses a window that ends before it starts", async () => {
    const database = freshDatabase();
    await seed(database);
    const refusal = await refusalOf(
      compose(database, { validFrom: "2026-08-08", validTo: "2026-08-07" }),
    );
    expect(refusal.code).toBe("invalid-validity-window");
  });

  it("accepts a civil-date window, a one-day window, and an open-ended assignment", async () => {
    const database = freshDatabase();
    await seed(database);
    const windowed = await compose(database, { validFrom: "2026-01-15", validTo: "2026-08-07" });
    const oneDay = await compose(database, { validFrom: "2026-08-07", validTo: "2026-08-07" });
    const open = await compose(database, {});
    for (const built of [windowed, oneDay, open]) {
      for (const statement of built.statements) await statement.run();
    }
    const { rows, capped } = await listMatterAssignments(database, MATTER_ID);
    expect(rows).toHaveLength(3);
    expect(capped).toBe(false);
    // Same role and creation instant for all three, so the listing's order among them is by id.
    const bounds = rows.map((row) => row.validTo);
    expect(bounds.filter((bound) => bound === "2026-08-07")).toHaveLength(2);
    expect(bounds.filter((bound) => bound === null)).toHaveLength(1);
  });

  it("ends an assignment with the ending instant — the deliberate non-civil-date form", async () => {
    const database = freshDatabase();
    await seed(database);
    const built = await compose(database, {});
    for (const statement of built.statements) await statement.run();
    const ended = await composeEndMatterAssignment(
      database,
      MATTER_ID,
      built.assignmentId,
      context,
    );
    for (const statement of ended.statements) await statement.run();
    const { rows } = await listMatterAssignments(database, MATTER_ID);
    expect(rows[0]?.validTo).toBe("2026-08-07T12:00:00.000Z");
  });
});
