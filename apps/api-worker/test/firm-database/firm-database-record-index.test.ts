import { env, runInDurableObject } from "cloudflare:test";
import { recordMatchExpression } from "@magna-carta/search/record-index-query";
import { describe, expect, it } from "vitest";
import type { FirmDatabase } from "../../src/firm-database/firm-database-object.ts";

// THE RECORD INDEX, IN THE STORAGE A FIRM ACTUALLY RUNS ON.
//
// Every other test of the index runs against node:sqlite, which is a different build of SQLite from
// the one inside a Durable Object and has no authorizer in front of it. The index leans on three
// things a build may not carry or may refuse: a contentless full-text table that accepts deletes,
// triggers that write to a virtual table, and a column-filtered match. This asks the real storage
// for all three, through the migration every firm applies on wake.
//
// A task is the record used because it can stand on no matter, so the question is about the index
// and needs nothing else seeded.

const SCOPE = { sourceKeys: ["tasks"] } as const;

describe("the record index inside a firm's Durable Object", () => {
  it("indexes, re-indexes and forgets a record as its row is written", async () => {
    const stub = env.FIRM_DATABASE.get(env.FIRM_DATABASE.idFromName("firm_record_index"));
    const outcome = await runInDurableObject(stub, (_instance: FirmDatabase, state) => {
      const sql = state.storage.sql;
      const matching = (text: string): string[] =>
        sql
          .exec<{ record_id: string }>(
            `SELECT record_text_entry.record_id AS record_id FROM record_text_fts ` +
              `JOIN record_text_entry ON record_text_entry.id = record_text_fts.rowid ` +
              `WHERE record_text_fts MATCH ?`,
            recordMatchExpression(text, SCOPE),
          )
          .toArray()
          .map((row) => row.record_id);

      sql.exec(
        `INSERT INTO matter_task (id, title, body, created_by, created_at, updated_at) ` +
          `VALUES ('task_probe', 'Draft the easement', 'for the Peña parcel', 'user_probe', ` +
          `'2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
      );
      const afterInsert = { prefix: matching("ease"), folded: matching("pena ") };

      sql.exec(`UPDATE matter_task SET title = 'Draft the covenant' WHERE id = 'task_probe'`);
      const afterUpdate = { old: matching("easement "), fresh: matching("covenant ") };

      sql.exec(`DELETE FROM matter_task WHERE id = 'task_probe'`);
      const afterDelete = {
        found: matching("covenant "),
        entries: sql.exec(`SELECT COUNT(*) AS n FROM record_text_entry`).one().n,
      };
      // The full-text table's own consistency check; it throws on a corrupt index.
      sql.exec(`INSERT INTO record_text_fts (record_text_fts) VALUES ('integrity-check')`);
      return { afterInsert, afterUpdate, afterDelete };
    });

    expect(outcome).toEqual({
      afterInsert: { prefix: ["task_probe"], folded: ["task_probe"] },
      afterUpdate: { old: [], fresh: ["task_probe"] },
      afterDelete: { found: [], entries: 0 },
    });
  });
});
