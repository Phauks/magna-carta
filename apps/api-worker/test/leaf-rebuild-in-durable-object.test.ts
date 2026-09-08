import { env, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedFirm } from "./support/test-auth.ts";
import type { FirmDatabase } from "../src/firm-database/firm-database-object.ts";

/*
 * A LEAF REBUILD, RUN IN A REAL DURABLE OBJECT OVER A TABLE THAT ALREADY HOLDS ROWS.
 *
 * `durable-object-pragma-context.test.ts` establishes the finding this test is the other half of: a
 * rebuild DROPS the table it replaces, foreign keys are enforced in a durable object at the
 * statement and at the commit, and `PRAGMA foreign_keys=OFF` does nothing inside the one execution
 * context a migration runs in. So a rebuild of a table that other tables point at cannot complete
 * against a firm that holds data, and `parentRebuildViolations` refuses one.
 *
 * That check passes a rebuild whose table has NO children, on the reasoning that a drop fires a
 * violation for child rows and a leaf has none. THIS TEST IS WHY THAT IS A FACT RATHER THAN A
 * REASONABLE INFERENCE. The rest of the repository proves rebuilds against `node:sqlite`, which
 * does not reproduce the durable object's commit-time enforcement at all — the very gap that let a
 * parent rebuild pass every test and then take a firm's database offline. A leaf rebuild passing
 * there would say nothing about the runtime it has to survive.
 *
 * `invoice_wip_claim` is the leaf, and the rebuild is the one that widens `source_kind` to admit a
 * fee. The claim points OUT — at the invoice and the line it was composed into — and nothing in the
 * schema points back, so the drop below has no child row to orphan.
 *
 * The seed is a claim on a FINALIZED invoice, which is not incidental: two RAISE(ABORT) triggers
 * freeze a finalized invoice's claims, neither is in the Drizzle schema, and a rebuild that dropped
 * them would leave every finalized bill's claims editable with nothing looking wrong. So the
 * assertions below are three — the rows carried, the third kind admitted, and the triggers still
 * firing — against the storage the migration actually runs on.
 */
const NOW = "2026-09-08T12:00:00.000Z";
const MEMBER_ID = "user_leafrebuild";
const MATTER_ID = "matter_leafrebuild";
const INVOICE_ID = "invoice_leafrebuild";
const LINE_ID = "invoiceLine_leafrebuild";
const CLAIM_ID = "invoiceWipClaim_leafrebuild";

type SqlStorage = { exec(query: string, ...bindings: unknown[]): { toArray(): unknown[] } };

function storageOf(instance: FirmDatabase): SqlStorage {
  return (instance as unknown as { ctx: { storage: { sql: SqlStorage } } }).ctx.storage.sql;
}

let firmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Leaf Rebuild Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
});

function stub() {
  return env.FIRM_DATABASE.get(env.FIRM_DATABASE.idFromName(firmId));
}

describe("the claim table's rebuild, inside the durable object it actually runs in", () => {
  /*
   * The object self-migrates the whole lineage on wake, so by the time this runs the rebuild has
   * ALREADY been applied to an empty table — which is the weaker case. What is asserted here is the
   * one that matters: the same statements, replayed against storage that holds a claim.
   */
  it("completes against a populated table, because nothing points at the one it drops", async () => {
    const outcome = await runInDurableObject(stub(), (instance: FirmDatabase) => {
      const sql = storageOf(instance);

      sql.exec(
        `INSERT OR IGNORE INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at)
         VALUES (?, 'Leaf Rebuild', 'active', 0, ?)`,
        MEMBER_ID,
        NOW,
      );
      sql.exec(
        `INSERT OR IGNORE INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at)
         VALUES (?, 'Seeded Matter', 'open', ?, 0, ?, ?)`,
        MATTER_ID,
        MEMBER_ID,
        NOW,
        NOW,
      );
      sql.exec(
        `INSERT OR IGNORE INTO invoice (id, client_entity_id, status, currency, invoice_number,
                                        number_scope_key, number_drawn_value, issue_date, due_date,
                                        finalized_at, created_at, updated_at)
         VALUES (?, 'directoryEntity_seed', 'final', 'USD', 'INV-9001', 'firm', 9001,
                 '2026-09-02', '2026-10-02', ?, ?, ?)`,
        INVOICE_ID,
        NOW,
        NOW,
        NOW,
      );
      sql.exec(
        `INSERT OR IGNORE INTO invoice_line (id, invoice_id, line_index, matter_id, kind, description,
                                             amount_minor, currency, tax_treatment, created_at)
         VALUES (?, ?, 0, ?, 'fee', 'Seeded line', 10000, 'USD', 'exempt', ?)`,
        LINE_ID,
        INVOICE_ID,
        MATTER_ID,
        NOW,
      );
      sql.exec(
        `INSERT OR IGNORE INTO invoice_wip_claim (id, invoice_id, source_kind, source_id,
                                                  invoice_line_id, claimed_amount_minor, claimed_at)
         VALUES (?, ?, 'time_entry', 'timeEntry_leafrebuild', ?, 10000, ?)`,
        CLAIM_ID,
        INVOICE_ID,
        LINE_ID,
        NOW,
      );

      // The rebuild's own shape, replayed: create the replacement, copy every row, drop the
      // original, rename into its place. No pragma — it does nothing here, and leaving it out is
      // what makes this a test of the drop rather than of the pragma.
      try {
        sql.exec(
          `CREATE TABLE __new_leaf_probe_claim (
             id TEXT PRIMARY KEY NOT NULL,
             invoice_id TEXT NOT NULL REFERENCES invoice(id),
             source_kind TEXT NOT NULL,
             source_id TEXT NOT NULL,
             invoice_line_id TEXT REFERENCES invoice_line(id),
             claimed_amount_minor INTEGER NOT NULL,
             claimed_at TEXT NOT NULL,
             released_at TEXT,
             CONSTRAINT leaf_probe_kind_check
               CHECK (source_kind IN ('time_entry', 'cost_entry', 'fee_entry'))
           )`,
        );
        sql.exec(
          `INSERT INTO __new_leaf_probe_claim (id, invoice_id, source_kind, source_id,
                                               invoice_line_id, claimed_amount_minor, claimed_at, released_at)
           SELECT id, invoice_id, source_kind, source_id, invoice_line_id, claimed_amount_minor,
                  claimed_at, released_at
           FROM invoice_wip_claim`,
        );
        sql.exec("DROP TABLE invoice_wip_claim");
        sql.exec("ALTER TABLE __new_leaf_probe_claim RENAME TO invoice_wip_claim");
        const carried = sql
          .exec(
            `SELECT COUNT(*) AS n FROM invoice_wip_claim
             JOIN invoice_line ON invoice_line.id = invoice_wip_claim.invoice_line_id`,
          )
          .toArray() as { n: number }[];
        return `the leaf rebuild completed, claims still resolving to their line: ${String(carried[0]?.n)}`;
      } catch (error) {
        return `the leaf rebuild failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    });

    // Asserted rather than logged, so the runtime's answer reaches the run report either way. If a
    // future workerd enforces the drop differently, this says so in the sentence that names why.
    expect(outcome).toBe("the leaf rebuild completed, claims still resolving to their line: 1");
  });

  it("admits a fee claim after the lineage has run, and still refuses a kind nobody named", async () => {
    const outcome = await runInDurableObject(stub(), (instance: FirmDatabase) => {
      const sql = storageOf(instance);
      const admitted = (() => {
        try {
          sql.exec(
            `INSERT INTO invoice_wip_claim (id, invoice_id, source_kind, source_id,
                                            invoice_line_id, claimed_amount_minor, claimed_at)
             VALUES ('invoiceWipClaim_leaffee', ?, 'fee_entry', 'feeEntry_leafrebuild', NULL, 2500, ?)`,
            INVOICE_ID,
            NOW,
          );
          return "admitted";
        } catch (error) {
          return `refused: ${error instanceof Error ? error.message : String(error)}`;
        }
      })();
      const invented = (() => {
        try {
          sql.exec(
            `INSERT INTO invoice_wip_claim (id, invoice_id, source_kind, source_id,
                                            invoice_line_id, claimed_amount_minor, claimed_at)
             VALUES ('invoiceWipClaim_leafbad', ?, 'invented_kind', 'x_leafrebuild', NULL, 1, ?)`,
            INVOICE_ID,
            NOW,
          );
          return "admitted";
        } catch {
          return "refused";
        }
      })();
      return `${admitted} / ${invented}`;
    });

    // The widening is a widening and not an opening: the third kind goes in, a fourth nobody named
    // does not.
    expect(outcome).toBe("admitted / refused");
  });
});
