import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyMigrations, loadMigrationsFromDisk } from "../src/node-sqlite.ts";
import { REVIEWED_REBUILDS } from "../src/reviewed-rebuilds.ts";

/*
 * EVERY REVIEWED REBUILD, RUN OVER A DATABASE THAT ALREADY HOLDS ROWS.
 *
 * Nothing else in this repository does. `createMigratedNodeDatabase` migrates an EMPTY database and
 * seeds afterwards, and the fixtures harness and the load-profile suites all build on it, so the
 * whole lineage is only ever applied to nothing. Two outages in one day came through that gap, and
 * both were the same shape: a rebuild that cannot survive contact with real data, passing every test
 * because no test had any.
 *
 * A rebuild is the one migration shape where an empty database is not a weaker case but a DIFFERENT
 * one. It drops the table it is replacing, and DROP TABLE on a parent fires a foreign-key violation
 * for every child row — of which an empty database has none. So the fixture that matters is not
 * volume; it is a single row in the table being rebuilt and a single row pointing at it.
 *
 * Each case below is exactly that, at the schema of the moment: seed the parent, seed one child,
 * apply the rest of the lineage, and require that it completes, that nothing is left dangling, and
 * that the child still resolves to the row it resolved to before. The last one is what makes this
 * more than a smoke test — a rebuild that silently re-keyed its rows would still "pass" a migration
 * that merely completed.
 *
 * REVIEWED_REBUILDS is the list of migrations that do this, and the pairing is asserted at the
 * bottom: a rebuild added without a case here fails, so the coverage cannot quietly fall behind the
 * thing it covers.
 */
const NOW = "2026-09-06T12:00:00.000Z";

interface RebuildCase {
  /** The migration, and the lineage it belongs to. */
  readonly lineage: "per-firm" | "control-plane";
  /** The table it rebuilds, and one table that points at it. */
  readonly rebuilt: string;
  readonly child: string;
  /** Rows at the schema of the moment: the parent, its own ancestors, and one child. */
  seed(raw: DatabaseSync): void;
  /**
   * How many children resolve to a parent that is really there — asked before the rebuild and
   * again after. Two functions rather than one because a rebuild may RETIRE the child table it is
   * asked about (the note revisions collapse into the note), and the question then has to be put a
   * different way on each side while still being the same question about the same row.
   */
  childrenAtSeed(raw: DatabaseSync): number;
  childrenAfterRebuild(raw: DatabaseSync): number;
}

function countJoin(raw: DatabaseSync, sql: string): number {
  return (raw.prepare(sql).get() as { n: number }).n;
}

const REBUILD_CASES: Record<string, RebuildCase> = {
  "20260829T101500_firmless-account": {
    lineage: "control-plane",
    rebuilt: "user",
    child: "account",
    seed(raw) {
      raw
        .prepare("INSERT INTO firm (id, name, created_at) VALUES (?, 'Seeded Firm', ?)")
        .run("firm_seed", NOW);
      raw
        .prepare("INSERT INTO user (id, name, email, firm_id) VALUES (?, 'Seeded Person', ?, ?)")
        .run("user_seed", "seeded@example.com", "firm_seed");
      raw
        .prepare(
          `INSERT INTO account (id, account_id, provider_id, user_id, updated_at)
           VALUES (?, ?, 'credential', ?, ?)`,
        )
        .run("account_seed", "seeded@example.com", "user_seed", 1_757_000_000_000);
    },
    childrenAtSeed: countAccounts,
    childrenAfterRebuild: countAccounts,
  },

  "20260901T120000_matter-notes-edit-and-delete": {
    lineage: "per-firm",
    rebuilt: "matter_note",
    child: "matter_note_revision",
    seed(raw) {
      seedMatter(raw);
      // An ACTIVE note: the rebuild deliberately does not carry retracted ones across, so a
      // retracted note would be a case about deletion rather than about the drop.
      raw
        .prepare(
          `INSERT INTO matter_note (id, matter_id, author_user_id, head_ordinal, state, created_at, updated_at)
           VALUES ('matterNote_seed', 'matter_seed', 'user_seed', 1, 'active', ?, ?)`,
        )
        .run(NOW, NOW);
      // The head revision the rebuild joins on to find the body it carries forward.
      raw
        .prepare(
          `INSERT INTO matter_note_revision (id, note_id, body, author_user_id, ordinal, created_at)
           VALUES ('matterNoteRevision_seed', 'matterNote_seed', 'The body.', 'user_seed', 1, ?)`,
        )
        .run(NOW);
    },
    childrenAtSeed(raw) {
      return countJoin(
        raw,
        `SELECT COUNT(*) AS n FROM matter_note_revision
         JOIN matter_note ON matter_note.id = matter_note_revision.note_id`,
      );
    },
    childrenAfterRebuild(raw) {
      // The revision table is retired here — the note holds its own body afterwards — so the
      // surviving row is the note carrying that body across, which is the same row's survival.
      return countJoin(
        raw,
        "SELECT COUNT(*) AS n FROM matter_note WHERE id = 'matterNote_seed' AND body = 'The body.'",
      );
    },
  },

  "20260901T150000_tasks": {
    lineage: "per-firm",
    rebuilt: "notification_event",
    child: "notification_recipient",
    seed(raw) {
      raw
        .prepare(
          `INSERT INTO notification_event
             (id, kind, category, severity, subject_kind, subject_id, occurred_at, dedupe_key, created_at)
           VALUES ('notificationEvent_seed', 'seeded.kind', 'system', 'informational', 'matter',
                   'matter_seed', ?, 'seeded-dedupe', ?)`,
        )
        .run(NOW, NOW);
      raw
        .prepare(
          `INSERT INTO notification_recipient
             (id, notification_event_id, recipient_user_id, created_at)
           VALUES ('notificationRecipient_seed', 'notificationEvent_seed', 'user_seed', ?)`,
        )
        .run(NOW);
    },
    childrenAtSeed: countNotificationRecipients,
    childrenAfterRebuild: countNotificationRecipients,
  },

  "20260905T195543_intake-step-kinds-client-forms-and-payment": {
    lineage: "per-firm",
    rebuilt: "intake_procedure_step",
    child: "matter_intake_step_record",
    seed(raw) {
      seedMatter(raw);
      raw
        .prepare(
          `INSERT INTO intake_procedure (id, name, created_by, created_at, updated_at)
           VALUES ('intakeProcedure_seed', 'Seeded Procedure', 'user_seed', ?, ?)`,
        )
        .run(NOW, NOW);
      raw
        .prepare(
          `INSERT INTO intake_procedure_step (id, procedure_id, kind, title, created_at, updated_at)
           VALUES ('intakeProcedureStep_seed', 'intakeProcedure_seed', 'questionnaire', 'A step', ?, ?)`,
        )
        .run(NOW, NOW);
      raw
        .prepare(
          `INSERT INTO matter_intake_step_record
             (id, matter_id, procedure_step_id, outcome, recorded_by, recorded_at)
           VALUES ('matterIntakeStepRecord_seed', 'matter_seed', 'intakeProcedureStep_seed',
                   'completed', 'user_seed', ?)`,
        )
        .run(NOW);
    },
    childrenAtSeed: countIntakeStepRecords,
    childrenAfterRebuild: countIntakeStepRecords,
  },

  "20260906T013304_matter-status-intake-and-consultation": {
    lineage: "per-firm",
    rebuilt: "matter",
    child: "matter_party",
    seed: seedMatterWithParty,
    childrenAtSeed: countMatterParties,
    childrenAfterRebuild: countMatterParties,
  },

  "20260906T030014_matter-hold-status": {
    lineage: "per-firm",
    rebuilt: "matter",
    child: "matter_party",
    seed: seedMatterWithParty,
    childrenAtSeed: countMatterParties,
    childrenAfterRebuild: countMatterParties,
  },

  /*
   * THE ONE CASE WHERE THE ARROW POINTS THE OTHER WAY. Nothing in the schema references
   * `invoice_wip_claim` — it is a leaf, and it is the claim that points OUT, at the invoice and the
   * line it was composed into. So the pairing here is the claim against the line it names, which
   * asks the same question this harness exists to ask: after the copy, does the row still resolve
   * to what it resolved to before? A rebuild that re-keyed its rows would complete and lose the
   * link between a billed entry and the line the client was actually charged on.
   *
   * The invoice is FINALIZED rather than draft, which is not incidental. Two `RAISE(ABORT)`
   * triggers freeze a finalized invoice's claims and neither is in the Drizzle schema, so a
   * generated rebuild would drop them and leave every finalized bill's claims editable with nothing
   * about the database looking wrong. `invoice-wip-claim-rebuild-migration.test.ts` is where those
   * triggers are proved to still fire; this case is the population half.
   */
  "20260907T221500_invoice-wip-claim-admits-a-fee": {
    lineage: "per-firm",
    rebuilt: "invoice_wip_claim",
    child: "invoice_line",
    seed: seedFinalizedInvoiceWithClaim,
    childrenAtSeed: countClaimsResolvingToTheirLine,
    childrenAfterRebuild: countClaimsResolvingToTheirLine,
  },
};

/** The member a matter must name, and the matter itself. `open` is legal at every point below. */
function seedMatter(raw: DatabaseSync): void {
  raw
    .prepare(
      `INSERT OR IGNORE INTO member (user_id, display_name, created_at)
       VALUES ('user_seed', 'Seeded Person', ?)`,
    )
    .run(NOW);
  raw
    .prepare(
      `INSERT OR IGNORE INTO matter (id, title, status, responsible_member_id, created_at, updated_at)
       VALUES ('matter_seed', 'Seeded Matter', 'open', 'user_seed', ?, ?)`,
    )
    .run(NOW, NOW);
}

function seedMatterWithParty(raw: DatabaseSync): void {
  seedMatter(raw);
  raw
    .prepare(
      `INSERT INTO matter_party (id, matter_id, entity_id, role, created_at, updated_at)
       VALUES ('matterParty_seed', 'matter_seed', 'directoryEntity_seed', 'client', ?, ?)`,
    )
    .run(NOW, NOW);
}

function countAccounts(raw: DatabaseSync): number {
  return countJoin(raw, "SELECT COUNT(*) AS n FROM account JOIN user ON user.id = account.user_id");
}

function countNotificationRecipients(raw: DatabaseSync): number {
  return countJoin(
    raw,
    `SELECT COUNT(*) AS n FROM notification_recipient
     JOIN notification_event ON notification_event.id = notification_recipient.notification_event_id`,
  );
}

function countIntakeStepRecords(raw: DatabaseSync): number {
  return countJoin(
    raw,
    `SELECT COUNT(*) AS n FROM matter_intake_step_record
     JOIN intake_procedure_step ON intake_procedure_step.id = matter_intake_step_record.procedure_step_id`,
  );
}

/**
 * A finalized invoice with one line and one claim against it.
 *
 * The invoice carries its number, its two dates and its finalized instant because four paired
 * CHECKs on `invoice` tie all of them to `status = 'final'` — a finalized invoice with any of them
 * missing is not a state the schema will hold, so a thinner seed would be testing a row that cannot
 * exist. No time entry sits behind the claim: `source_id` carries no foreign key, because it names
 * a row in one of three tables and SQLite cannot express that, so the rebuild's behaviour does not
 * depend on the source row existing.
 */
function seedFinalizedInvoiceWithClaim(raw: DatabaseSync): void {
  seedMatter(raw);
  raw
    .prepare(
      `INSERT INTO invoice (id, client_entity_id, status, currency, invoice_number, number_scope_key,
                            number_drawn_value, issue_date, due_date, finalized_at, created_at, updated_at)
       VALUES ('invoice_seed', 'directoryEntity_seed', 'final', 'USD', 'INV-0001', 'firm', 1,
               '2026-09-02', '2026-10-02', ?, ?, ?)`,
    )
    .run(NOW, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO invoice_line (id, invoice_id, line_index, matter_id, kind, description,
                                 amount_minor, currency, tax_treatment, created_at)
       VALUES ('invoiceLine_seed', 'invoice_seed', 0, 'matter_seed', 'fee', 'Seeded line',
               10000, 'USD', 'exempt', ?)`,
    )
    .run(NOW);
  raw
    .prepare(
      `INSERT INTO invoice_wip_claim (id, invoice_id, source_kind, source_id, invoice_line_id,
                                      claimed_amount_minor, claimed_at)
       VALUES ('invoiceWipClaim_seed', 'invoice_seed', 'time_entry', 'timeEntry_seed',
               'invoiceLine_seed', 10000, ?)`,
    )
    .run(NOW);
}

function countMatterParties(raw: DatabaseSync): number {
  return countJoin(
    raw,
    "SELECT COUNT(*) AS n FROM matter_party JOIN matter ON matter.id = matter_party.matter_id",
  );
}

function countClaimsResolvingToTheirLine(raw: DatabaseSync): number {
  return countJoin(
    raw,
    `SELECT COUNT(*) AS n FROM invoice_wip_claim
     JOIN invoice_line ON invoice_line.id = invoice_wip_claim.invoice_line_id`,
  );
}

describe("every reviewed rebuild, applied to a database that already holds rows", () => {
  for (const [tag, rebuild] of Object.entries(REBUILD_CASES)) {
    it(`${tag} carries its ${rebuild.rebuilt} rows across, and what points at them`, () => {
      const migrations = loadMigrationsFromDisk(rebuild.lineage);
      const at = migrations.findIndex((migration) => migration.tag === tag);
      expect(at, `${tag} is no longer in the ${rebuild.lineage} lineage`).toBeGreaterThan(0);

      const raw = new DatabaseSync(":memory:");
      applyMigrations(raw, migrations.slice(0, at));
      rebuild.seed(raw);
      expect(rebuild.childrenAtSeed(raw)).toBe(1);

      // The rest of the lineage, not just this migration: a rebuild that breaks something for a
      // LATER migration is the same outage, and stopping at this one would not see it.
      expect(() => applyMigrations(raw, migrations.slice(at))).not.toThrow();

      // Completing is not enough. Nothing dangling, and the child still resolves to a row that is
      // really there — a rebuild that re-keyed its rows would complete and lose every reference.
      expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(rebuild.childrenAfterRebuild(raw)).toBe(1);
    });
  }

  it("covers every reviewed rebuild, so the coverage cannot fall behind the list", () => {
    // The pairing is the point. A rebuild is added to REVIEWED_REBUILDS by someone who has audited
    // the copy by reading it; this requires that it also be run over rows before it ships.
    expect(Object.keys(REBUILD_CASES).toSorted()).toEqual([...REVIEWED_REBUILDS].toSorted());
  });
});
