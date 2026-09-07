import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyMigrations, loadMigrationsFromDisk } from "../src/node-sqlite.ts";

/*
 * The claim table's rebuild, applied to a database that already holds claims.
 *
 * `invoice_wip_claim.source_kind` carried a CHECK naming two kinds, and SQLite cannot widen a CHECK
 * in place, so admitting a third cost a create-copy-drop-rename on a financial table. Two things
 * about that rebuild can fail silently, and silently is the whole problem: a generated rebuild
 * would produce a table that looks right and behaves differently.
 *
 * ONE — THE FREEZE TRIGGERS ARE NOT IN THE DRIZZLE SCHEMA. They were written by the migration that
 * created this table, so nothing in the schema would put them back. A rebuild that dropped them
 * would leave every finalized invoice's claims editable, which is the opposite of what the billing
 * design settled: once an entry is billed it is evidence. Nothing about the resulting database
 * would look wrong — the table would be there, the rows would be there, and the guard would simply
 * be gone.
 *
 * TWO — THE COPY RUNS WHILE `invoice_line` STILL POINTS AT THE OLD TABLE. The matter-status rename
 * shipped a rebuild that passed every fixture and failed on the first firm that held a child row,
 * because a fixture with no children cannot show a foreign-key violation. So the seed here holds a
 * claim that is REFERENCED, on an invoice that is FINALIZED — the state that exercises both hazards
 * at once.
 *
 * No time entry is seeded behind the claim, deliberately. `source_id` carries no foreign key —
 * it names a row in one of three tables, which is a reference SQLite cannot express — so the
 * rebuild's behaviour does not depend on the source row existing, and seeding one would only tie
 * this test to a column list it has no stake in.
 */
const REBUILD_TAG = "20260907T221500_invoice-wip-claim-admits-a-fee";
const NOW = "2026-09-07T12:00:00.000Z";
const MEMBER_ID = "user_claimrebuild";
const MATTER_ID = "matter_claimrebuild";
const INVOICE_ID = "invoice_claimrebuild";
const LINE_ID = "invoiceLine_claimrebuild";
const CLAIM_ID = "invoiceWipClaim_claimrebuild";
const TIME_ENTRY_ID = "timeEntry_claimrebuild";

/**
 * A finalized invoice with one line and one claim against it.
 *
 * The invoice carries its number, its two dates and its finalized instant because four paired
 * CHECKs on `invoice` tie all of them to `status = 'final'` — a finalized invoice with any of them
 * missing is not a state the schema will hold, so a thinner seed would be testing a row that
 * cannot exist.
 *
 * Finalized rather than draft on purpose: a draft invoice's claims are mutable, so a database whose
 * only claim sits on a draft would pass a freeze assertion that never fired.
 */
function seedFinalizedClaim(raw: DatabaseSync): void {
  raw
    .prepare(
      `INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at)
       VALUES (?, 'Claim Rebuild', 'active', 0, ?)`,
    )
    .run(MEMBER_ID, NOW);
  raw
    .prepare(
      `INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at)
       VALUES (?, 'Seeded Matter', 'open', ?, 0, ?, ?)`,
    )
    .run(MATTER_ID, MEMBER_ID, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO invoice (id, client_entity_id, status, currency, invoice_number, number_scope_key, number_drawn_value, issue_date, due_date, finalized_at, created_at, updated_at)
       VALUES (?, 'directoryEntity_seed', 'final', 'USD', 'INV-0001', 'firm', 1, '2026-09-02', '2026-10-02', ?, ?, ?)`,
    )
    .run(INVOICE_ID, NOW, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO invoice_line (id, invoice_id, line_index, matter_id, kind, description, amount_minor, currency, tax_treatment, created_at)
       VALUES (?, ?, 0, ?, 'fee', 'Seeded line', 10000, 'USD', 'exempt', ?)`,
    )
    .run(LINE_ID, INVOICE_ID, MATTER_ID, NOW);
  raw
    .prepare(
      `INSERT INTO invoice_wip_claim (id, invoice_id, source_kind, source_id, invoice_line_id, claimed_amount_minor, claimed_at)
       VALUES (?, ?, 'time_entry', ?, ?, 10000, ?)`,
    )
    .run(CLAIM_ID, INVOICE_ID, TIME_ENTRY_ID, LINE_ID, NOW);
}

describe("the claim table's rebuild, applied to a database that already holds a claim", () => {
  it("carries the claim across, keeps its line pointing at it, and admits the third kind", () => {
    const migrations = loadMigrationsFromDisk("per-firm");
    const rebuildAt = migrations.findIndex((migration) => migration.tag === REBUILD_TAG);
    // A collapsed lineage retires this migration; when that happens this whole test goes with it.
    expect(rebuildAt, `${REBUILD_TAG} is no longer in the per-firm lineage`).toBeGreaterThan(0);

    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw, migrations.slice(0, rebuildAt));
    seedFinalizedClaim(raw);

    expect(() => applyMigrations(raw, migrations.slice(rebuildAt))).not.toThrow();

    // Nothing was re-keyed and nothing was orphaned by dropping the parent out from under a child.
    expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      raw.prepare("SELECT id, source_kind, invoice_line_id FROM invoice_wip_claim").all(),
    ).toEqual([{ id: CLAIM_ID, source_kind: "time_entry", invoice_line_id: LINE_ID }]);

    // The point of the whole rebuild: a third kind is now admissible where it was refused before.
    expect(() =>
      raw
        .prepare(
          `INSERT INTO invoice_wip_claim (id, invoice_id, source_kind, source_id, invoice_line_id, claimed_amount_minor, claimed_at)
           VALUES ('invoiceWipClaim_fee', ?, 'fee_entry', 'feeEntry_seed', NULL, 2500, ?)`,
        )
        .run(INVOICE_ID, NOW),
    ).not.toThrow();

    // And a kind nobody named is still refused, so the widening did not become an opening.
    expect(() =>
      raw
        .prepare(
          `INSERT INTO invoice_wip_claim (id, invoice_id, source_kind, source_id, invoice_line_id, claimed_amount_minor, claimed_at)
           VALUES ('invoiceWipClaim_bad', ?, 'invented_kind', 'x_seed', NULL, 1, ?)`,
        )
        .run(INVOICE_ID, NOW),
    ).toThrow();
  });

  it("still freezes a finalized invoice's claims, which is the part a rebuild loses silently", () => {
    const migrations = loadMigrationsFromDisk("per-firm");
    const rebuildAt = migrations.findIndex((migration) => migration.tag === REBUILD_TAG);
    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw, migrations.slice(0, rebuildAt));
    seedFinalizedClaim(raw);
    applyMigrations(raw, migrations.slice(rebuildAt));

    // Both triggers, because they guard different verbs and a rebuild can drop either.
    expect(() =>
      raw.prepare("UPDATE invoice_wip_claim SET released_at = ? WHERE id = ?").run(NOW, CLAIM_ID),
    ).toThrow(/immutable/);
    expect(() => raw.prepare("DELETE FROM invoice_wip_claim WHERE id = ?").run(CLAIM_ID)).toThrow(
      /immutable/,
    );

    // The guard is the INVOICE's state, not the claim's: the same two verbs are legal on a draft.
    raw
      .prepare(
        `INSERT INTO invoice (id, client_entity_id, status, currency, created_at, updated_at)
         VALUES ('invoice_draft', 'directoryEntity_seed', 'draft', 'USD', ?, ?)`,
      )
      .run(NOW, NOW);
    raw
      .prepare(
        `INSERT INTO invoice_wip_claim (id, invoice_id, source_kind, source_id, invoice_line_id, claimed_amount_minor, claimed_at)
         VALUES ('invoiceWipClaim_draft', 'invoice_draft', 'fee_entry', 'feeEntry_draft', NULL, 2500, ?)`,
      )
      .run(NOW);
    expect(() =>
      raw
        .prepare("UPDATE invoice_wip_claim SET released_at = ? WHERE id = 'invoiceWipClaim_draft'")
        .run(NOW),
    ).not.toThrow();
  });
});
