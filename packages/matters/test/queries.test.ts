import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { MatterTypeId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { listConsultations, listMatters } from "../src/queries.ts";

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
  status: "prospective" | "open" | "closed";
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

async function setup(): Promise<BatchDatabase> {
  const database = freshDatabase();
  await seedMember(database, ATTORNEY);
  await seedMember(database, OTHER);
  return database;
}

const day = (n: number) => `2026-06-${String(n).padStart(2, "0")}T12:00:00.000Z`;

describe("listMatters", () => {
  it("excludes prospectives by default", async () => {
    const database = await setup();
    await seedMatter(database, { id: "matter_p", status: "prospective", createdAt: day(1) });
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
  it("returns the member's prospectives with a stale flag at the day boundary", async () => {
    const database = await setup();
    const nowInstant = "2026-06-13T12:00:00.000Z";
    // Created exactly 14 days ago -> stale (inclusive boundary); 13 days ago -> fresh.
    await seedMatter(database, {
      id: "matter_stale",
      status: "prospective",
      createdAt: "2026-05-30T12:00:00.000Z",
      responsibleMemberId: ATTORNEY,
    });
    await seedMatter(database, {
      id: "matter_fresh",
      status: "prospective",
      createdAt: "2026-05-31T12:00:00.000Z",
      responsibleMemberId: ATTORNEY,
    });
    // Another member's prospective must not appear.
    await seedMatter(database, {
      id: "matter_other",
      status: "prospective",
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
