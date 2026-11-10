import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { MatterId, MatterTypeId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { clientMattersNarrowing, ownMattersNarrowing } from "../src/matter-narrowing.ts";
import {
  findMattersByNumbers,
  listConsultations,
  listMatters,
  readMatterFilingTargets,
  readMattersByIds,
} from "../src/queries.ts";

const ATTORNEY = "user_attorney" as UserId;
const OTHER = "user_other" as UserId;

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

async function seedMember(database: BatchDatabase, userId: string): Promise<void> {
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'M', 'active', '2026-01-01T00:00:00.000Z')",
    )
    .bind(userId)
    .run();
}

interface SeedMatter {
  id: string;
  status: "intake" | "consultation" | "open" | "closed";
  createdAt: string;
  responsibleMemberId?: string;
  matterTypeId?: string | null;
  title?: string;
  matterNumber?: string | null;
}

async function seedMatter(database: BatchDatabase, matter: SeedMatter): Promise<void> {
  await database
    .prepare(
      "INSERT INTO matter (id, title, description, status, matter_type_id, location_id, responsible_member_id, client_display_name, client_code, matter_number, numbered_at, opened_at, closed_at, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, ?4, NULL, ?5, NULL, NULL, ?6, NULL, NULL, NULL, ?7, ?7)",
    )
    .bind(
      matter.id,
      matter.title ?? "Matter",
      matter.status,
      matter.matterTypeId ?? null,
      matter.responsibleMemberId ?? ATTORNEY,
      matter.matterNumber ?? null,
      matter.createdAt,
    )
    .run();
}

async function seedType(database: BatchDatabase, id: string): Promise<void> {
  await database
    .prepare(
      "INSERT INTO matter_type (id, name, code, active, created_at, updated_at) VALUES (?1, ?1, NULL, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )
    .bind(id)
    .run();
}

let seeded = 0;

async function seedAssignment(
  database: BatchDatabase,
  assignment: { matterId: string; validTo: string | null },
): Promise<void> {
  seeded += 1;
  await database
    .prepare(
      "INSERT INTO matter_assignment (id, matter_id, member_user_id, assignment_role, valid_from, valid_to, created_at, updated_at) VALUES (?1, ?2, ?3, 'assigned_paralegal', NULL, ?4, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )
    .bind(`matterAssignment_${seeded}`, assignment.matterId, ATTORNEY, assignment.validTo)
    .run();
}

async function seedParty(
  database: BatchDatabase,
  party: { matterId: string; entityId: string; role?: string; deleted?: boolean },
): Promise<void> {
  seeded += 1;
  await database
    .prepare(
      "INSERT INTO matter_party (id, matter_id, entity_id, role, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?5)",
    )
    .bind(
      `matterParty_${seeded}`,
      party.matterId,
      party.entityId,
      party.role ?? "client",
      party.deleted === true ? "2026-02-01T00:00:00.000Z" : null,
    )
    .run();
}

async function setup(): Promise<BatchDatabase> {
  const database = freshDatabase();
  await seedMember(database, ATTORNEY);
  await seedMember(database, OTHER);
  return database;
}

const day = (n: number) => `2026-06-${String(n).padStart(2, "0")}T12:00:00.000Z`;

describe("listMatters", () => {
  it("excludes intakes and consultations by default", async () => {
    const database = await setup();
    await seedMatter(database, { id: "matter_i", status: "intake", createdAt: day(0) });
    await seedMatter(database, { id: "matter_p", status: "consultation", createdAt: day(1) });
    await seedMatter(database, { id: "matter_o", status: "open", createdAt: day(2) });
    await seedMatter(database, { id: "matter_c", status: "closed", createdAt: day(3) });
    const { data } = await listMatters(database, {});
    expect(data.map((row) => row.id).sort()).toEqual(["matter_c", "matter_o"]);
  });

  it("filters by status, type, and responsible member, composing", async () => {
    const database = await setup();
    await seedType(database, "matterType_pi");
    await seedType(database, "matterType_fa");
    await seedMatter(database, {
      id: "matter_a",
      status: "open",
      createdAt: day(1),
      matterTypeId: "matterType_pi",
      responsibleMemberId: ATTORNEY,
    });
    await seedMatter(database, {
      id: "matter_b",
      status: "open",
      createdAt: day(2),
      matterTypeId: "matterType_fa",
      responsibleMemberId: ATTORNEY,
    });
    await seedMatter(database, {
      id: "matter_c",
      status: "open",
      createdAt: day(3),
      matterTypeId: "matterType_pi",
      responsibleMemberId: OTHER,
    });
    const { data } = await listMatters(database, {
      status: "open",
      matterTypeId: "matterType_pi" as MatterTypeId,
      responsibleMemberId: ATTORNEY,
    });
    expect(data.map((row) => row.id)).toEqual(["matter_a"]);
  });

  it("narrows to a member's own matters: responsible for, or currently assigned to", async () => {
    const database = await setup();
    await seedMatter(database, { id: "matter_led", status: "open", createdAt: day(1) });
    for (const id of ["matter_assigned", "matter_ended", "matter_theirs"]) {
      await seedMatter(database, {
        id,
        status: "open",
        createdAt: day(2),
        responsibleMemberId: OTHER,
      });
    }
    await seedAssignment(database, { matterId: "matter_assigned", validTo: null });
    await seedAssignment(database, { matterId: "matter_ended", validTo: day(3) });
    const { data } = await listMatters(database, {
      narrowings: [ownMattersNarrowing(ATTORNEY)],
    });
    expect(data.map((row) => row.id).sort()).toEqual(["matter_assigned", "matter_led"]);
  });

  it("narrows to one client's matters, a co-client's among them, and composes with a search", async () => {
    const database = await setup();
    await seedMatter(database, { id: "matter_one", status: "open", createdAt: day(1) });
    await seedMatter(database, {
      id: "matter_two",
      status: "open",
      createdAt: day(2),
      title: "Hargrove easement",
    });
    await seedMatter(database, { id: "matter_other", status: "open", createdAt: day(3) });
    await seedMatter(database, { id: "matter_removed", status: "open", createdAt: day(4) });
    await seedParty(database, { matterId: "matter_one", entityId: "person_client" });
    // A second client on a matter that already has one.
    await seedParty(database, { matterId: "matter_two", entityId: "person_first" });
    await seedParty(database, { matterId: "matter_two", entityId: "person_client" });
    // The same person on a matter in another role, and as a client party since removed.
    await seedParty(database, {
      matterId: "matter_other",
      entityId: "person_client",
      role: "witness",
    });
    await seedParty(database, {
      matterId: "matter_removed",
      entityId: "person_client",
      deleted: true,
    });
    const narrowings = [clientMattersNarrowing("person_client")];
    const all = await listMatters(database, { narrowings });
    expect(all.data.map((row) => row.id).sort()).toEqual(["matter_one", "matter_two"]);
    const searched = await listMatters(database, { narrowings, search: "easement" });
    expect(searched.data.map((row) => row.id)).toEqual(["matter_two"]);
  });

  it("matches the search term against title and number", async () => {
    const database = await setup();
    await seedMatter(database, {
      id: "matter_x",
      status: "open",
      createdAt: day(1),
      title: "Acme acquisition",
      matterNumber: "2026-0001",
    });
    await seedMatter(database, {
      id: "matter_y",
      status: "open",
      createdAt: day(2),
      title: "Beta merger",
      matterNumber: "2026-0002",
    });
    expect((await listMatters(database, { search: "acme" })).data.map((r) => r.id)).toEqual([
      "matter_x",
    ]);
    expect((await listMatters(database, { search: "0002" })).data.map((r) => r.id)).toEqual([
      "matter_y",
    ]);
  });

  it("paginates by cursor without dropping or repeating rows", async () => {
    const database = await setup();
    for (let i = 1; i <= 3; i++) {
      await seedMatter(database, { id: `matter_${i}`, status: "open", createdAt: day(i) });
    }
    const first = await listMatters(database, { pageSize: 2 });
    expect(first.data).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await listMatters(database, {
      pageSize: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.data).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const seen = [...first.data, ...second.data].map((row) => row.id);
    expect(new Set(seen).size).toBe(3);
  });
});

describe("listConsultations", () => {
  it("returns the member's consultations with a stale flag at the day boundary", async () => {
    const database = await setup();
    const nowInstant = "2026-06-13T12:00:00.000Z";
    // Created exactly 14 days ago -> stale (inclusive boundary); 13 days ago -> fresh.
    await seedMatter(database, {
      id: "matter_stale",
      status: "consultation",
      createdAt: "2026-05-30T12:00:00.000Z",
      responsibleMemberId: ATTORNEY,
    });
    await seedMatter(database, {
      id: "matter_fresh",
      status: "consultation",
      createdAt: "2026-05-31T12:00:00.000Z",
      responsibleMemberId: ATTORNEY,
    });
    // Another member's consultation must not appear.
    await seedMatter(database, {
      id: "matter_other",
      status: "consultation",
      createdAt: "2026-05-30T12:00:00.000Z",
      responsibleMemberId: OTHER,
    });
    // An open matter for the member must not appear in consultations.
    await seedMatter(database, {
      id: "matter_open",
      status: "open",
      createdAt: day(1),
      responsibleMemberId: ATTORNEY,
    });
    const { data } = await listConsultations(database, {
      responsibleMemberId: ATTORNEY,
      now: nowInstant,
      staleAgeDays: 14,
    });
    const byId = new Map(data.map((row) => [row.id as string, row.isStale]));
    expect([...byId.keys()].sort()).toEqual(["matter_fresh", "matter_stale"]);
    expect(byId.get("matter_stale")).toBe(true);
    expect(byId.get("matter_fresh")).toBe(false);
  });
});

describe("readMattersByIds", () => {
  it("hydrates a known set in one read, regardless of lifecycle status", async () => {
    const database = await setup();
    await seedMatter(database, { id: "matter_p", status: "consultation", createdAt: day(1) });
    await seedMatter(database, { id: "matter_c", status: "closed", createdAt: day(2) });
    const rows = await readMattersByIds(database, [
      "matter_p" as MatterId,
      "matter_c" as MatterId,
      "matter_absent" as MatterId,
    ]);
    expect(rows.map((row) => row.id).sort()).toEqual(["matter_c", "matter_p"]);
    expect(await readMattersByIds(database, [])).toEqual([]);
  });

  it("never returns a system matter", async () => {
    const database = await setup();
    await seedMatter(database, { id: "matter_system", status: "open", createdAt: day(1) });
    await database
      .prepare("UPDATE matter SET system_key = 'scans' WHERE id = 'matter_system'")
      .run();
    expect(await readMattersByIds(database, ["matter_system" as MatterId])).toEqual([]);
  });
});

describe("readMatterFilingTargets", () => {
  it("reports status and platform ownership rather than filtering either out", async () => {
    const database = await setup();
    await seedMatter(database, { id: "matter_open", status: "open", createdAt: day(1) });
    await seedMatter(database, { id: "matter_closed", status: "closed", createdAt: day(2) });
    await seedMatter(database, { id: "matter_system", status: "open", createdAt: day(3) });
    await database
      .prepare("UPDATE matter SET system_key = 'scans' WHERE id = 'matter_system'")
      .run();
    const targets = await readMatterFilingTargets(database, [
      "matter_open" as MatterId,
      "matter_closed" as MatterId,
      "matter_system" as MatterId,
      "matter_absent" as MatterId,
    ]);
    expect([...targets].sort((left, right) => left.id.localeCompare(right.id))).toEqual([
      { id: "matter_closed", status: "closed", systemOwned: false },
      { id: "matter_open", status: "open", systemOwned: false },
      { id: "matter_system", status: "open", systemOwned: true },
    ]);
    // A matter that does not exist simply is not reported — the caller reads that absence as "no
    // answer", which is not the same as "not a legitimate target".
    expect(await readMatterFilingTargets(database, [])).toEqual([]);
  });
});

describe("findMattersByNumbers", () => {
  it("matches a number exactly, never as a substring", async () => {
    const database = await setup();
    await seedMatter(database, {
      id: "matter_numbered",
      status: "open",
      createdAt: day(1),
      matterNumber: "2026-0007",
    });
    expect((await findMattersByNumbers(database, ["2026-0007"])).map((row) => row.id)).toEqual([
      "matter_numbered",
    ]);
    // A subject line saying "2026" must not drag in every matter opened that year.
    expect(await findMattersByNumbers(database, ["2026"])).toEqual([]);
    expect(await findMattersByNumbers(database, [])).toEqual([]);
  });

  it("never returns a system matter", async () => {
    const database = await setup();
    await seedMatter(database, {
      id: "matter_system_numbered",
      status: "open",
      createdAt: day(1),
      matterNumber: "SYS-0001",
    });
    await database
      .prepare("UPDATE matter SET system_key = 'scans' WHERE id = 'matter_system_numbered'")
      .run();
    expect(await findMattersByNumbers(database, ["SYS-0001"])).toEqual([]);
  });
});
