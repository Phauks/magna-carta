import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { expect, test } from "vitest";
import { migrateClientDisplayFields } from "../src/client-migration.ts";

const clock = { now: () => "2026-06-17T00:00:00.000Z" };
const ACTOR = "user_actor" as UserId;

interface TestContext {
  readonly database: BatchDatabase;
  readonly db: {
    get<T>(sql: string, params?: unknown[]): Promise<T>;
  };
  readonly options: {
    clock: typeof clock;
    actorUserId: UserId;
    randomSource: ReturnType<typeof seededRandomSource>;
  };
}

async function directoryTestContext(seed: string): Promise<TestContext> {
  const { database } = createMigratedNodeDatabase("per-firm");
  // The migration's only acting member; matter.responsible_member_id is a real foreign key.
  await database
    .prepare(
      `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('user_a', 'Member A', 'active', ?1)`,
    )
    .bind(clock.now())
    .run();
  return {
    database,
    db: {
      async get<T>(sql: string, params: unknown[] = []): Promise<T> {
        const { results } = await database
          .prepare(sql)
          .bind(...params)
          .all<T>();
        return results[0] as T;
      },
    },
    options: { clock, actorUserId: ACTOR, randomSource: seededRandomSource(seed) },
  };
}

async function seedMatterWithDisplayClient(
  ctx: TestContext,
  input: { matterId: string; clientDisplayName: string; clientCode: string },
): Promise<void> {
  await ctx.database
    .prepare(
      `INSERT INTO matter (id, title, status, responsible_member_id, client_display_name, client_code, created_at, updated_at) VALUES (?1, 'Demo Matter', 'open', 'user_a', ?2, ?3, ?4, ?4)`,
    )
    .bind(input.matterId, input.clientDisplayName, input.clientCode, clock.now())
    .run();
}

test("migrates 1·1 client_display_name/client_code into a Person entity + role='client' link", async () => {
  const ctx = await directoryTestContext("t14");
  await seedMatterWithDisplayClient(ctx, {
    matterId: "mat_x",
    clientDisplayName: "Acme Corp",
    clientCode: "ACME",
  });
  await migrateClientDisplayFields(ctx.database, ctx.options);
  const link = await ctx.db.get<{ entity_id: string; role: string }>(
    "SELECT entity_id, role FROM matter_party WHERE matter_id='mat_x'",
  );
  expect(link.role).toBe("client");
  const entity = await ctx.db.get<{ display_name: string }>(
    "SELECT display_name FROM directory_organization WHERE id=?",
    [link.entity_id],
  );
  expect(entity.display_name).toBe("Acme Corp");
});

test("a personal display name migrates to a Person entity, split given/family", async () => {
  const ctx = await directoryTestContext("t14-person");
  await seedMatterWithDisplayClient(ctx, {
    matterId: "mat_p",
    clientDisplayName: "Jane Doe",
    clientCode: "DOE",
  });
  await migrateClientDisplayFields(ctx.database, ctx.options);
  const link = await ctx.db.get<{ entity_id: string; role: string }>(
    "SELECT entity_id, role FROM matter_party WHERE matter_id='mat_p'",
  );
  expect(link.role).toBe("client");
  const entity = await ctx.db.get<{
    name_given: string;
    name_family: string;
    needs_review: number;
  }>("SELECT name_given, name_family, needs_review FROM directory_person WHERE id=?", [
    link.entity_id,
  ]);
  expect(entity.name_given).toBe("Jane");
  expect(entity.name_family).toBe("Doe");
  expect(entity.needs_review).toBe(0);
});

test("an ambiguous/blank display name migrates to a provisional review entity, never auto-merged", async () => {
  const ctx = await directoryTestContext("t14-blank");
  await seedMatterWithDisplayClient(ctx, {
    matterId: "mat_blank",
    clientDisplayName: "   ",
    clientCode: "BLANK",
  });
  await migrateClientDisplayFields(ctx.database, ctx.options);
  const link = await ctx.db.get<{ entity_id: string; role: string }>(
    "SELECT entity_id, role FROM matter_party WHERE matter_id='mat_blank'",
  );
  expect(link.role).toBe("client");
  // Blank name → a provisional Person flagged needs_review, never an organization, never merged.
  expect(link.entity_id.startsWith("directoryPerson_")).toBe(true);
  const entity = await ctx.db.get<{ needs_review: number; name_family: string | null }>(
    "SELECT needs_review, name_family FROM directory_person WHERE id=?",
    [link.entity_id],
  );
  expect(entity.needs_review).toBe(1);
  expect(entity.name_family).toBeNull();
});

test("identical display names across matters get distinct entities — no auto-merge on a bare string", async () => {
  const ctx = await directoryTestContext("t14-dup");
  await seedMatterWithDisplayClient(ctx, {
    matterId: "mat_a",
    clientDisplayName: "Acme Corp",
    clientCode: "A",
  });
  await seedMatterWithDisplayClient(ctx, {
    matterId: "mat_b",
    clientDisplayName: "Acme Corp",
    clientCode: "B",
  });
  await migrateClientDisplayFields(ctx.database, ctx.options);
  const a = await ctx.db.get<{ entity_id: string }>(
    "SELECT entity_id FROM matter_party WHERE matter_id='mat_a'",
  );
  const b = await ctx.db.get<{ entity_id: string }>(
    "SELECT entity_id FROM matter_party WHERE matter_id='mat_b'",
  );
  expect(a.entity_id).not.toBe(b.entity_id);
});

test("re-running the migration is idempotent", async () => {
  const ctx = await directoryTestContext("t14-idem");
  await seedMatterWithDisplayClient(ctx, {
    matterId: "mat_y",
    clientDisplayName: "Acme Corp",
    clientCode: "ACME",
  });
  await migrateClientDisplayFields(ctx.database, ctx.options);
  await migrateClientDisplayFields(ctx.database, {
    ...ctx.options,
    randomSource: seededRandomSource("t14-idem-2"),
  });
  const { results } = await ctx.database
    .prepare("SELECT id FROM matter_party WHERE matter_id='mat_y' AND role='client'")
    .all<{ id: string }>();
  expect(results).toHaveLength(1);
});
