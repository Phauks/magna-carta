import { beforeEach, describe, expect, it } from "vitest";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { createNotificationPolicyReader } from "../src/preferences.ts";
import { notificationTypeForKey } from "../src/registry.ts";
import { resolveNotificationRecipients } from "../src/recipients.ts";

// The audience resolvers against the committed per-firm migrations, because what `matter-team`
// means is a question about two tables and a validity window rather than about a function.

type Database = ReturnType<typeof createMigratedNodeDatabase>["database"];

const NOW = "2026-08-15T12:00:00.000Z";
const RESPONSIBLE = "user_responsible00000";
const PARALEGAL = "user_paralegal0000000";
const SUPERVISOR = "user_supervisor000000";
const DEPARTED = "user_departed00000000";
const MATTER = "matter_staffed000000";

const QUARANTINED = notificationTypeForKey("documents.file.quarantined");

async function seed(database: Database): Promise<void> {
  const members = [
    [RESPONSIBLE, "active"],
    [PARALEGAL, "active"],
    [SUPERVISOR, "active"],
    [DEPARTED, "deactivated"],
  ] as const;
  await Promise.all(
    members.map(([userId, status]) =>
      database
        .prepare(
          "INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at) VALUES (?1, ?2, ?3, 0, ?4)",
        )
        .bind(userId, `Member ${userId}`, status, NOW)
        .run(),
    ),
  );
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, 'Staffed Matter', 'open', ?2, 0, ?3, ?3)",
    )
    .bind(MATTER, RESPONSIBLE, NOW)
    .run();
}

async function assign(
  database: Database,
  options: {
    id: string;
    memberUserId: string;
    role: string;
    validFrom?: string | null;
    validTo?: string | null;
  },
): Promise<void> {
  await database
    .prepare(
      "INSERT INTO matter_assignment (id, matter_id, member_user_id, assignment_role, valid_from, valid_to, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
    )
    .bind(
      options.id,
      MATTER,
      options.memberUserId,
      options.role,
      options.validFrom ?? null,
      options.validTo ?? null,
      NOW,
    )
    .run();
}

function resolveTeam(database: Database, matterId: string | null = MATTER) {
  if (QUARANTINED === undefined) throw new Error("the quarantine type is not registered");
  return resolveNotificationRecipients(QUARANTINED, {
    database,
    matterId,
    actorUserId: null,
    now: () => NOW,
    // This helper drives a `capability-holders` type, which names no recipient of its own.
    namedRecipientUserId: null,
    namedMemberUserIds: [],
    policy: createNotificationPolicyReader(database),
  });
}

describe("the matter-team audience", () => {
  let database: Database;
  beforeEach(async () => {
    database = createMigratedNodeDatabase("per-firm").database;
    await seed(database);
  });

  it("reaches the responsible member and every currently-assigned member, deduplicated", async () => {
    await assign(database, {
      id: "matterAssignment_para1",
      memberUserId: PARALEGAL,
      role: "assigned_paralegal",
    });
    await assign(database, {
      id: "matterAssignment_super1",
      memberUserId: SUPERVISOR,
      role: "supervising_attorney",
      validFrom: "2026-01-01",
    });
    // The responsible attorney cannot hold an assignment role that normalizes to their own, but
    // nothing stops them being staffed in a second capacity — and they are one recipient, not two.
    await assign(database, {
      id: "matterAssignment_resp1",
      memberUserId: RESPONSIBLE,
      role: "billing_attorney",
    });

    // The read orders by user id, so the expected list is written in that order rather than sorted
    // at the assertion — a resolver that stopped ordering would otherwise pass this test.
    const resolution = await resolveTeam(database);
    expect(resolution.recipientUserIds).toEqual([PARALEGAL, RESPONSIBLE, SUPERVISOR]);
    expect(resolution.substituted).toBe(false);
  });

  it("excludes an assignment whose window has closed, in EITHER recorded form", async () => {
    // A bound recorded at creation is a civil date inclusive of its whole day; a bound stamped by
    // the end-assignment path is the ending instant, exclusive from that moment. Both must exclude,
    // or an ended assignment keeps hearing about a matter its member is off.
    await assign(database, {
      id: "matterAssignment_civil1",
      memberUserId: PARALEGAL,
      role: "assigned_paralegal",
      validTo: "2026-08-14",
    });
    await assign(database, {
      id: "matterAssignment_inst1",
      memberUserId: SUPERVISOR,
      role: "supervising_attorney",
      validTo: "2026-08-15T09:00:00.000Z",
    });

    expect((await resolveTeam(database)).recipientUserIds).toEqual([RESPONSIBLE]);
  });

  it("includes an assignment on its last civil day and excludes one that has not started", async () => {
    await assign(database, {
      id: "matterAssignment_today1",
      memberUserId: PARALEGAL,
      role: "assigned_paralegal",
      validTo: "2026-08-15",
    });
    await assign(database, {
      id: "matterAssignment_future",
      memberUserId: SUPERVISOR,
      role: "supervising_attorney",
      validFrom: "2026-09-01",
    });

    expect((await resolveTeam(database)).recipientUserIds).toEqual([PARALEGAL, RESPONSIBLE]);
  });

  it("excludes a deactivated member whose assignment was never ended", async () => {
    // The ordinary case rather than the exception: staffing history is a matter record, so a
    // departure deactivates the member and leaves the assignment row open. This audience reaches
    // email, which a deactivated member's feed does not.
    await assign(database, {
      id: "matterAssignment_gone1",
      memberUserId: DEPARTED,
      role: "assigned_paralegal",
    });

    expect((await resolveTeam(database)).recipientUserIds).toEqual([RESPONSIBLE]);
  });

  it("resolves an unstaffed matter to its responsible member, never to nobody", async () => {
    const resolution = await resolveTeam(database);
    expect(resolution.recipientUserIds).toEqual([RESPONSIBLE]);
    // Not a substitution: the responsible member IS the team of a matter nobody else is staffed on,
    // and a team of one is a correct answer rather than a narrowed one.
    expect(resolution.substituted).toBe(false);
  });

  it("resolves to nobody when there is no matter to resolve a team from", async () => {
    expect((await resolveTeam(database, null)).recipientUserIds).toEqual([]);
  });
});
