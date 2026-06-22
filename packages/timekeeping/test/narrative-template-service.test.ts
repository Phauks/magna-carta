import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  listNarrativeTemplatesStatement,
  recentNarrativesStatement,
} from "../src/narrative-template-statements.ts";
import {
  archiveNarrativeTemplate,
  createNarrativeTemplate,
  updateNarrativeTemplate,
} from "../src/narrative-template-service.ts";

const clock = { now: () => "2026-06-22T12:00:00.000Z" };
const ADMIN = "user_admin" as UserId;
const TIMEKEEPER = "user_attorney" as UserId;
const options = { clock, actorUserId: ADMIN };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

async function seedUtbms(database: BatchDatabase): Promise<void> {
  await database
    .prepare("INSERT INTO utbms_code (id, code_set, code, label, active) VALUES ('utbmsCode_l120', 'task', 'L120', 'Analysis/Strategy', 1)")
    .run();
}

async function listTemplates(database: BatchDatabase) {
  const { results } = await listNarrativeTemplatesStatement(database).all<{
    id: string;
    utbms_task_code_id: string | null;
    narrative_template: string;
    default_rate_e4: number | null;
    archived_at: string | null;
  }>();
  return results;
}

describe("narrative templates", () => {
  it("stores a template carrying the optional task code and default rate, and lists active ones", async () => {
    const database = freshDatabase();
    await seedUtbms(database);
    const created = await createNarrativeTemplate(
      database,
      {
        utbmsTaskCodeId: "utbmsCode_l120",
        narrativeTemplate: "Analysis and strategy re: ",
        defaultRateE4: 4500000,
      },
      options,
    );
    await commitEffectBatch(database, created.effect, { now: clock.now });
    const rows = await listTemplates(database);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      utbms_task_code_id: "utbmsCode_l120",
      narrative_template: "Analysis and strategy re: ",
      default_rate_e4: 4500000,
      archived_at: null,
    });
  });

  it("stores a template with no task code and no default rate", async () => {
    const database = freshDatabase();
    const created = await createNarrativeTemplate(
      database,
      { narrativeTemplate: "Telephone conference with client" },
      options,
    );
    await commitEffectBatch(database, created.effect, { now: clock.now });
    expect((await listTemplates(database))[0]).toMatchObject({
      utbms_task_code_id: null,
      default_rate_e4: null,
    });
  });

  it("updates and soft-archives a template, auditing each", async () => {
    const database = freshDatabase();
    const created = await createNarrativeTemplate(database, { narrativeTemplate: "Draft memo" }, options);
    await commitEffectBatch(database, created.effect, { now: clock.now });
    await commitEffectBatch(
      database,
      (await updateNarrativeTemplate(database, created.narrativeTemplateId, { narrativeTemplate: "Draft memorandum" }, options)).effect,
      { now: clock.now },
    );
    await commitEffectBatch(
      database,
      (await archiveNarrativeTemplate(database, created.narrativeTemplateId, options)).effect,
      { now: clock.now },
    );
    // Archived templates drop out of the active list.
    expect(await listTemplates(database)).toHaveLength(0);

    const { results: audits } = await database
      .prepare("SELECT event FROM audit_log ORDER BY created_at")
      .all<{ event: string }>();
    expect(audits.map((a) => a.event)).toEqual([
      "narrative_template.created",
      "narrative_template.updated",
      "narrative_template.archived",
    ]);
  });

  it("refuses an empty template body", async () => {
    const database = freshDatabase();
    await expect(
      createNarrativeTemplate(database, { narrativeTemplate: "   " }, options),
    ).rejects.toMatchObject({ code: "empty-name" });
  });
});

describe("recent narratives", () => {
  it("returns the timekeeper's distinct recent narratives, most recent first", async () => {
    const database = freshDatabase();
    // Seed the matter + timekeeper the entries reference.
    await database.prepare("INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'A', 'active', ?2)").bind(TIMEKEEPER, clock.now()).run();
    await database.prepare("INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at) VALUES ('matter_1', 'M', 'open', ?1, 0, ?2, ?2)").bind(TIMEKEEPER, clock.now()).run();

    // Three entries; two share a narrative — the read must de-dup.
    let n = 0;
    for (const [narrative, date] of [
      ["reviewed pleadings", "2026-06-20"],
      ["drafted demand letter", "2026-06-21"],
      ["reviewed pleadings", "2026-06-22"],
    ] as const) {
      n += 1;
      await database
        .prepare(
          "INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, currency, status, source, created_at, updated_at) VALUES (?1, 'matter_1', ?2, ?3, 30, 30, ?4, 1, 'USD', 'draft', 'manual', ?5, ?5)",
        )
        .bind(`timeEntry_${n}`, TIMEKEEPER, date, narrative, `2026-06-${20 + n}T00:00:00.000Z`)
        .run();
    }

    const { results } = await recentNarrativesStatement(database, TIMEKEEPER, 10).all<{
      narrative: string;
    }>();
    const narratives = results.map((r) => r.narrative);
    expect(narratives).toEqual(["reviewed pleadings", "drafted demand letter"]);
  });
});
