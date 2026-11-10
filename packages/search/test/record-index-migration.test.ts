import { applyMigrations, loadMigrationsFromDisk } from "@magna-carta/database/node-sqlite";
import { nodeSqliteBatchDatabase } from "@magna-carta/database/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  assertIndexConsistent,
  entries,
  find,
  MATTER,
  OTHER_MATTER,
  seedCommunication,
  seedConversation,
  seedCostEntry,
  seedEvent,
  seedMatters,
  seedNote,
  seedTask,
  seedTimeEntry,
  seedTurn,
} from "./record-index-support.ts";

// THE MIGRATION THAT INTRODUCES THE RECORD INDEX, RUN OVER A DATABASE THAT ALREADY HOLDS RECORDS.
//
// Every firm that applies it has years of notes and narratives written before the index existed,
// and the fill is the only thing that will ever index them: the triggers see only what is written
// afterwards. A fill that is wrong is indistinguishable from a correct one against an empty
// database, so this seeds records at the schema as it stood just before, applies the rest of the
// lineage, and requires each record to be where a reader would look for it — and each record that
// should not be searchable to be absent.

// Found by its name rather than its full tag: the tag is its place in the apply order, which moves
// when the branch carrying it is brought up to date before it lands.
const SLUG = "_record-text-index";

function seededThenMigrated(): { raw: DatabaseSync } {
  const migrations = loadMigrationsFromDisk("per-firm");
  const position = migrations.findIndex((migration) => migration.tag.endsWith(SLUG));
  if (position === -1) throw new Error(`no per-firm migration is named *${SLUG}`);
  const raw = new DatabaseSync(":memory:");
  applyMigrations(raw, migrations.slice(0, position));

  seedMatters(raw);
  seedNote(raw, {
    id: "note_1",
    matterId: MATTER,
    body: "The easement was recorded.",
    occurredOn: "2026-07-04",
  });
  seedNote(raw, { id: "note_2", matterId: OTHER_MATTER, body: "Easement survey received." });
  seedTimeEntry(raw, {
    id: "time_1",
    matterId: MATTER,
    narrative: "Reviewed easement survey",
    workDate: "2026-07-05",
  });
  seedCostEntry(raw, { id: "cost_1", matterId: MATTER, description: "Easement recording fee" });
  seedCostEntry(raw, { id: "cost_blank", matterId: MATTER, description: "" });
  seedEvent(raw, { id: "event_1", matterId: MATTER, title: "Easement hearing" });
  seedCommunication(raw, { id: "comm_1", matterId: null, summary: "Voicemail about the easement" });
  seedCommunication(raw, { id: "comm_blank", matterId: MATTER });
  seedTask(raw, { id: "task_1", matterId: MATTER, title: "Draft the easement" });
  seedConversation(raw, { id: "conv_1", matterId: MATTER, title: "Easement questions" });
  seedTurn(raw, {
    id: "turn_1",
    conversationId: "conv_1",
    sequence: 1,
    content: "Is the easement appurtenant?",
  });
  seedTurn(raw, {
    id: "turn_pending",
    conversationId: "conv_1",
    sequence: 2,
    content: null,
    status: "pending",
  });
  seedConversation(raw, { id: "conv_deleted", matterId: MATTER, title: "Easement, abandoned" });
  seedTurn(raw, {
    id: "turn_deleted",
    conversationId: "conv_deleted",
    sequence: 1,
    content: "easement",
  });
  raw.exec(
    `UPDATE magnus_conversation SET state = 'deleted', deleted_at = '2026-08-02T00:00:00.000Z' WHERE id = 'conv_deleted'`,
  );

  applyMigrations(raw, migrations.slice(position));
  return { raw };
}

describe("the record index migration over a firm that already holds records", () => {
  it("indexes every existing record that has words, with its matter and its place", () => {
    const { raw } = seededThenMigrated();
    expect(entries(raw)).toEqual([
      {
        source: "calendar",
        record_id: "event_1",
        container_id: null,
        matter_id: MATTER,
        sort_key: "2026-07-03",
      },
      {
        source: "communications",
        record_id: "comm_1",
        container_id: null,
        matter_id: null,
        sort_key: "2026-08-01T09:00:00.000Z",
      },
      {
        source: "costs",
        record_id: "cost_1",
        container_id: null,
        matter_id: MATTER,
        sort_key: "2026-07-02",
      },
      {
        source: "magnus-conversations",
        record_id: "conv_1",
        container_id: null,
        matter_id: MATTER,
        sort_key: "2026-08-01T09:00:00.000Z",
      },
      {
        source: "magnus-turns",
        record_id: "turn_1",
        container_id: "conv_1",
        matter_id: MATTER,
        sort_key: "2026-08-01T09:00:00.000Z",
      },
      {
        source: "notes",
        record_id: "note_1",
        container_id: null,
        matter_id: MATTER,
        sort_key: "2026-07-04",
      },
      {
        source: "notes",
        record_id: "note_2",
        container_id: null,
        matter_id: OTHER_MATTER,
        sort_key: "2026-08-01",
      },
      {
        source: "tasks",
        record_id: "task_1",
        container_id: null,
        matter_id: MATTER,
        sort_key: "2026-08-01T09:00:00.000Z",
      },
      {
        source: "time",
        record_id: "time_1",
        container_id: null,
        matter_id: MATTER,
        sort_key: "2026-07-05",
      },
    ]);
    assertIndexConsistent(raw);
  });

  it("makes those records findable, each within its own matter", async () => {
    const { raw } = seededThenMigrated();
    const database = nodeSqliteBatchDatabase(raw);
    const everySource = [
      "notes",
      "time",
      "costs",
      "calendar",
      "communications",
      "tasks",
      "magnus-conversations",
      "magnus-turns",
    ];

    expect(
      (await find(database, "easement", { sourceKeys: everySource, matter: MATTER })).toSorted(),
    ).toEqual(["conv_1", "cost_1", "event_1", "note_1", "task_1", "time_1", "turn_1"]);
    expect(
      await find(database, "easement", { sourceKeys: everySource, matter: OTHER_MATTER }),
    ).toEqual(["note_2"]);
    expect(await find(database, "easement", { sourceKeys: everySource, matter: "none" })).toEqual([
      "comm_1",
    ]);
  });

  it("leaves the triggers in charge of everything written afterwards", async () => {
    const { raw } = seededThenMigrated();
    const database = nodeSqliteBatchDatabase(raw);
    // A record the fill indexed is edited: the trigger must replace the fill's entry, not add one.
    raw.exec(`UPDATE matter_note SET body = 'The covenant was recorded.' WHERE id = 'note_1'`);
    seedNote(raw, { id: "note_3", matterId: MATTER, body: "A new easement note." });

    expect(await find(database, "easement", { sourceKeys: ["notes"], matter: MATTER })).toEqual([
      "note_3",
    ]);
    expect(await find(database, "covenant", { sourceKeys: ["notes"], matter: MATTER })).toEqual([
      "note_1",
    ]);
    assertIndexConsistent(raw);
  });
});
