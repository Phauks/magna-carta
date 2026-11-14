// The two SQL fragments that say which check a payment has. Kept apart from ./checks.ts, with no
// imports, so ./statements.ts can read a printed check's number without a cycle back through the
// account tree.

const TRUST_CHECK_TABLE = "trust_check";
const TRUST_CHECK_EVENT_TABLE = "trust_check_event";

/**
 * A check is LIVE while it may still be the paper that pays its disbursement: numbered and not yet
 * answered, or confirmed printed. A spoiled or voided check is not, and its payment goes back to the
 * queue. One predicate, written once, so the queue, the register and the reconciliation's reference
 * all agree on which check a payment has.
 */
export function liveTrustCheckPredicate(alias: string): string {
  return `NOT EXISTS (SELECT 1 FROM ${TRUST_CHECK_EVENT_TABLE} live_event WHERE live_event.check_id = ${alias}.id AND live_event.kind IN ('spoiled', 'voided'))`;
}

/**
 * The number a payment's live check carries, as text, for a statement that already reads the
 * movement as `movementAlias`. The outstanding-items read uses it so the matcher sees a printed check's
 * number where the movement's own reference is empty.
 */
export function liveTrustCheckNumberExpression(movementAlias: string): string {
  return `(SELECT CAST(live_check.check_number AS TEXT) FROM ${TRUST_CHECK_TABLE} live_check WHERE live_check.movement_id = ${movementAlias}.id AND ${liveTrustCheckPredicate("live_check")} ORDER BY live_check.check_number DESC LIMIT 1)`;
}

