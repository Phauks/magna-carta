// Tags whose migration performs a reviewed SQLite table-rebuild (CREATE `__new_X` / copy / DROP /
// RENAME — what drizzle emits for an in-place ALTER SQLite cannot do). A rebuild is destructive DDL
// against a table that holds data, so the rule is that one is never a silent merge artifact: the
// integrity sentinel FAILS on any rebuild whose tag is not listed here, and adding a tag is the
// record that somebody asked the two questions that matter — does the copy preserve every row, and
// is the copy SELECT column-for-column correct.
//
// This lives in the database package rather than beside the sentinel because both the sentinel
// (tooling/migration-integrity/) and the lineage tests read it, and a second list would let a
// rebuild be acceptable to one and not the other.
// Rebuilds of a table that OTHER TABLES POINT AT, which is a shape that cannot run in production and
// must never be written again.
//
// A rebuild drops the table it replaces. In a Cloudflare durable object, foreign keys are enforced
// at the statement AND at the commit, and `PRAGMA foreign_keys=OFF` does nothing inside the single
// execution context a migration runs in — SQLite honours that pragma only outside a transaction and
// reports success either way. Four ways around it were tried against real durable-object storage
// (the pragma, yielding between the pragma and the drop, `defer_foreign_keys`, and rename-aside
// under `legacy_alter_table`); all four fail, and workerd resets the object rather than allow the
// violation. The probes are in apps/api-worker/test/durable-object-pragma-context.test.ts.
//
// So a `DROP TABLE` on a parent with children cannot complete against any firm database that holds
// data. It completes against an empty one, which is the only place it was ever tried.
//
// THESE SIX ARE DEBT, NOT PERMISSION. Each was written before that was understood, and each is
// unappliable to a firm whose rebuilt table has children — one of them is why a firm's database sat
// unreachable for a day. They are listed so the guard can tell an old mistake from a new one; the
// list must never grow.
//
// WIDENING A CHECK OR DROPPING A COLUMN ON A PARENT TABLE NOW HAS AN ANSWER, and it is not a
// cleverer rebuild: you add a column. Six mechanisms were probed against real durable-object storage
// and all six fail, `PRAGMA writable_schema` — SQLite's own documented way to change a constraint
// with nothing dropped — included, which workerd's authorizer refuses outright (SQLITE_AUTH). The
// probes are apps/api-worker/test/durable-object-pragma-context.test.ts, and the same file proves
// that an ADDED column may carry its own CHECK, including one naming a second column, which is what
// the route rests on. ADR-a-vocabulary-on-a-parent-table-grows-by-adding-a-column; the worked case is
// matter_task's rungs (20260914T120000_task-rungs-and-archive).
export const PARENT_REBUILDS_PREDATING_THE_DURABLE_OBJECT_FINDING: ReadonlySet<string> =
  new Set<string>(["20260829T101500_firmless-account"]);

export const REVIEWED_REBUILDS: ReadonlySet<string> = new Set<string>([
  // `invoice_wip_claim`.`source_kind` widened from two work-in-progress kinds to three, so a draft
  // invoice can claim a recorded fee the way it already claims an hour and a disbursement. A CHECK
  // cannot be widened in place, so this is a rebuild — and it is listed here rather than beside the
  // grandfathered parent rebuilds because `invoice_wip_claim` IS A LEAF: nothing in the schema
  // references it, so the DROP that cannot run against a parent fires no violation here, which is
  // exactly the condition parentRebuildViolations tests for. The claim points OUT, at the invoice
  // and the line it was composed into, and dropping a child is not what a durable object refuses.
  // Audited: the copy is column-for-column over the whole table — seven columns, in the order the
  // replacement declares them, with no WHERE and no expression between source and target — so every
  // claim carries across unchanged, and the CHECK cannot reject a copied row because the change only
  // ADDS a value to the set. The partial unique index that makes the claim the concurrency control,
  // and the two indexes beside it, are recreated after the rename; so are the two RAISE(ABORT)
  // triggers that freeze a finalized invoice's claims, which are NOT in the Drizzle schema and would
  // therefore have been dropped and never put back by a generated rebuild — the single worst thing
  // this migration could have done silently. The reasoning is written out in the migration's own
  // `-- contract:` header, and the durable-object case is proved rather than assumed in
  // apps/api-worker/test/leaf-rebuild-in-durable-object.test.ts.
  // `download_item` admits every download rather than only what the platform MADE: `producer` gains
  // `file`, `kind` gains `reference`, and `object_key`/`expires_at` become nullable so a row that
  // holds no bytes of the register's can say so. Audited: the copy is column-for-column over the
  // whole table — all twelve existing columns, in the order the replacement declares them, with no
  // WHERE and no expression between source and target — so every shelf item carries across
  // unchanged, and `subject_file_id` is the one new column, taking NULL. No CHECK can reject a
  // copied row: the two vocabularies only ADD values, the nonempty CHECK was widened to admit the
  // null it now permits, and the two new shape CHECKs hold for every pre-existing row (none is a
  // reference, and every one carries a key). It is listed beside the claim table's widening rather
  // than among the grandfathered parent rebuilds because `download_item` IS A LEAF: nothing in the
  // schema references it — it points OUT, at the member who owns it — so the drop fires no
  // violation, which is the condition parentRebuildViolations tests for. This table carries no
  // triggers, so the trap that made the claim rebuild worth hand-writing does not apply; both
  // indexes are recreated after the rename. The reasoning is written out in the migration's own
  // `-- contract:` header.
  "20260916T120000_download-register-admits-every-download",
  "20260908T040000_invoice-wip-claim-admits-a-fee",
  // `user`.`firm_id` widened to nullable, so an account can exist before it belongs to a firm.
  // Audited: the copy is column-for-column over the whole table, the foreign key and the unique
  // index on `email` are both carried across, and no row loses a value — the reasoning is written
  // out in the migration's own `-- contract:` header.
  "20260829T101500_firmless-account",
  // The matter note collapses from an identity row plus a revision chain into one row, edited in
  // place and deleted outright, on the owner's direction. Audited: every note that still stands
  // carries across with its head revision's body, joined on the (note_id, ordinal) unique index the
  // old schema pinned; the copy SELECT is column-for-column and the three new occurrence columns
  // take NULL, which each CHECK accepts. Retracted notes are deliberately NOT carried — the new
  // model has no state that could hold one, and copying its body would restore withdrawn text to
  // every surface. The reasoning is written out in the migration's own `-- contract:` header.
  // `tasks` joins the notification category vocabulary and `matterTask` its subject kinds, which are
  // CHECK constraints on `notification_event` and `notification_in_app_suppression` and so cannot be
  // widened in place. Audited: both copies are column-for-column over the whole table — eleven
  // columns and six respectively, in the order each replacement declares them, with no WHERE and no
  // expression between source and target — so every row carries across unchanged. Neither CHECK can
  // reject a copied row, because both changes only ADD values to a set: every category and subject
  // kind that was legal before is still legal. `notification_recipient.event_id` does carry a
  // foreign key into the rebuilt table, which is why the file brackets the swap in
  // PRAGMA foreign_keys=OFF/ON; it is safe because ids are preserved verbatim and the replacement
  // takes the original name, so every referencing row resolves to the row it resolved to before and
  // nothing is re-keyed. The reasoning is written out in the migration's own `-- contract:` header.
  // The intake procedure's step kinds gain `client-forms` and `payment`, a CHECK constraint on
  // `intake_procedure_step` that cannot be widened in place. Audited: the copy is column-for-column
  // over the whole table — eleven columns, in the order the replacement declares them, with no WHERE
  // and no expression between source and target — so every step carries across unchanged, and the
  // CHECK cannot reject a copied row because the change only ADDS values to the set. The
  // procedure's position index is recreated after the rename. `matter_intake_step_record.
  // procedure_step_id` carries a foreign key into the rebuilt table, which is why the file brackets
  // the swap in PRAGMA foreign_keys=OFF/ON; it is safe because ids are preserved verbatim and the
  // replacement takes the original name, so every member's record resolves to the step it resolved
  // to before. The reasoning is written out in the migration's own `-- contract:` header.
  // The matter lifecycle gains `intake` and renames `prospective` to `consultation`, a CHECK
  // constraint on `matter` that cannot be widened in place. Audited: the copy is column-for-column
  // over the whole table — nineteen columns, in the order the replacement declares them, with no
  // WHERE — so every matter carries across, none dropped. One column is not verbatim: `status` is
  // mapped through a CASE that rewrites `prospective` to `consultation`, the same rung under its
  // new name, leaving every other status untouched. That mapping is load-bearing, not tidiness.
  // The file first shipped copying `status` verbatim on the reasoning that no firm held a matter
  // at its date; a deployed firm did, so the replacement's CHECK rejected the row and the whole
  // migration failed. Because migrations run in the FirmDatabase durable object's constructor,
  // ahead of any read or write, that took the firm's entire database offline until the copy was
  // corrected. The six indexes, three of them partial uniques, are recreated after the rename.
  // Many tables carry a foreign key into `matter`, which is why the file brackets the swap in
  // PRAGMA foreign_keys=OFF/ON; it is safe because ids are preserved verbatim and the replacement
  // takes the original name, so every referencing row resolves to the row it resolved to before. The
  // reasoning is written out in the migration's own `-- contract:` header.
  // Widens matter_status_check with `hold` and adds the two hold columns (held_at, hold_reason) with
  // their paired-nullability CHECK. The copy is exhaustive over every existing column and NULL for
  // the two new ones; ids are preserved verbatim under PRAGMA foreign_keys=OFF/ON. The reasoning is
  // in the migration's own `-- contract:` header.
]);
