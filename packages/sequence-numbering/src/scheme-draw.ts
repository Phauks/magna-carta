import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  ensureCounterRowStatement,
  guardedIncrementStatement,
  readCounterValue,
  type SequenceNumberingTables,
} from "./counter-statements.ts";
import { schemePurposeOf, type SchemeNumberingPurpose } from "./purposes.ts";
import { deriveScopeKey, renderNumber, type RenderContext } from "./render.ts";
import { readSchemeInForce } from "./scheme-service.ts";
import { startValueOf, type NumberSegment } from "./segments.ts";

// A draw of a scheme-shaped number, planned in one place for every purpose that has one.
//
// The draw is the same four steps whoever asks: load the scheme in force (configured, or the
// purpose's default), derive the counter scope from the scoping segments under the purpose's
// prefix, read the counter, render. Matters wrote those steps inline and conflicts and custodian
// each wrote their own variation; a variation of a draw is where the subtlety goes missing, so the
// steps live here and a consumer composes what it returns into its own batch: the two opening
// statements first, its own record write, the allocation row last (the owner column is a foreign
// key). The bounded retry around the whole thing is bounded-retry.ts, and `observe` is fed from the
// plan so a losing attempt can advance this scope's counter out of band.

// A purpose with nothing in force and no default: only the matter run can reach this. The caller
// translates it into its own refusal — matters into `scheme-missing` — because the sentence a
// person sees belongs to the route that answers them.
export class NumberingSchemeMissingError extends Error {
  constructor(readonly purpose: SchemeNumberingPurpose) {
    super(`no active numbering scheme is configured for ${purpose}`);
    this.name = "NumberingSchemeMissingError";
  }
}

export interface SchemeDrawPlan {
  readonly segments: readonly NumberSegment[];
  /** The counter row this draw counts under: the purpose's prefix plus the scoping segments' values. */
  readonly scopeKey: string;
  /** The counter value this draw will consume, as read; the bounded retry's `observe` takes it. */
  readonly observedValue: number;
  readonly startValue: number;
  /** The rendered number, for the record write. */
  readonly number: string;
}

// The scheme a draw renders from, or a thrown NumberingSchemeMissingError.
export async function loadSchemeForDraw(
  database: SqlDatabase,
  purpose: SchemeNumberingPurpose,
): Promise<readonly NumberSegment[]> {
  const inForce = await readSchemeInForce(database, purpose);
  if (inForce === undefined) throw new NumberingSchemeMissingError(purpose);
  return inForce.segments;
}

// Everything a draw needs, read before the batch is composed. Pure apart from the two reads: the
// scheme row and the counter row. Throws NumberingRenderError when a scoping or valued segment has
// no value in the context, and NumberingSchemeMissingError when nothing is in force.
export async function planSchemeDraw(
  database: SqlDatabase,
  purpose: SchemeNumberingPurpose,
  tables: SequenceNumberingTables,
  context: RenderContext,
): Promise<SchemeDrawPlan> {
  const segments = await loadSchemeForDraw(database, purpose);
  const scopeKey = schemePurposeOf(purpose).scopePrefix + deriveScopeKey(segments, context);
  const startValue = startValueOf(segments);
  const observedValue = (await readCounterValue(database, tables, scopeKey)) ?? startValue;
  return {
    segments,
    scopeKey,
    observedValue,
    startValue,
    number: renderNumber(segments, context, observedValue),
  };
}

// The statements that open the draw: the counter row if it is the scope's first draw, then the
// guarded increment. Composed FIRST in the consumer's batch. The guard aborts nothing on its own —
// the allocation row the consumer composes last is the load-bearing backstop (counter-statements.ts).
export function schemeDrawOpeningStatements(
  database: SqlDatabase,
  tables: SequenceNumberingTables,
  plan: SchemeDrawPlan,
): SqlStatement[] {
  return [
    ensureCounterRowStatement(database, tables, plan.scopeKey, plan.startValue),
    guardedIncrementStatement(database, tables, plan.scopeKey, plan.observedValue),
  ];
}

// The number the next draw would render: a preview, never a reservation. A record a person quotes
// out loud is identified before it is saved (docs/conventions/design-corrections.md), so the screen
// that opens a check or logs a packet asks this first. The same plan as a real draw, with nothing
// composed from it.
export async function previewNextNumber(
  database: SqlDatabase,
  purpose: SchemeNumberingPurpose,
  tables: SequenceNumberingTables,
  context: RenderContext,
): Promise<string> {
  return (await planSchemeDraw(database, purpose, tables, context)).number;
}
