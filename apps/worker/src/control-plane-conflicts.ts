// UNIQUE-violation detection for control-plane write batches. A losing batch rolled back whole
// (statements + outbox + idempotency record), so the conflict is a clean signal the caller maps
// to its domain meaning — same detection idiom as isIdempotencyKeyConflict: D1 surfaces SQLite's
// message text, including the violated `table.column`.
function isUniqueConstraintConflict(error: unknown, qualifiedColumn: string): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(qualifiedColumn)
  );
}

// The duplicate-email signal of the user-creating effect batches (members.invite, firms.provision).
export function isUserEmailConflict(error: unknown): boolean {
  return isUniqueConstraintConflict(error, "user.email");
}

// The lost-race signal of the provisioner's find-or-insert on the firm name (its resume identity).
export function isFirmNameConflict(error: unknown): boolean {
  return isUniqueConstraintConflict(error, "firm.name");
}

// The activation-fence signal of the provisioner's final batch: the fence INSERT collides with
// the firm row's own PRIMARY KEY when another run already activated the firm — the loser's whole
// batch rolled back, and a retry observes the active firm (firm-provisioner.ts, concurrency note).
export function isFirmActivationConflict(error: unknown): boolean {
  return isUniqueConstraintConflict(error, "firm.id");
}
