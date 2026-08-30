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
export const REVIEWED_REBUILDS: ReadonlySet<string> = new Set<string>([
  // `user`.`firm_id` widened to nullable, so an account can exist before it belongs to a firm.
  // Audited: the copy is column-for-column over the whole table, the foreign key and the unique
  // index on `email` are both carried across, and no row loses a value — the reasoning is written
  // out in the migration's own `-- contract:` header.
  "20260829T101500_firmless-account",
]);
