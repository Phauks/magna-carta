import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  ensureCounterRowStatement,
  guardedAdvanceStatement,
  readCounterValue,
  type SequenceNumberingTables,
} from "./counter-statements.ts";
import { schemePurposeOf, type SchemeNumberingPurpose } from "./purposes.ts";
import { deriveScopeKey, renderNumber, type RenderContext } from "./render.ts";
import {
  claimReservedValueStatement,
  isValueAllocated,
  readReclaimableValues,
  readReservationByToken,
} from "./reservation-statements.ts";
import { readSchemeInForce } from "./scheme-service.ts";
import { startValueOf, type NumberSegment } from "./segments.ts";

// A draw of a scheme-shaped number, planned in one place for every purpose that has one.
//
// The draw is the same four steps whoever asks: load the scheme in force (configured, or the
// purpose's default), settle the counter scope, read the counter, render. Matters wrote those steps
// inline and conflicts and custodian each wrote their own variation; a variation of a draw is where
// the subtlety goes missing, so the steps live here and a consumer composes what it returns into
// its own batch: the two opening statements first, its own record write, the allocation row last
// (the owner column is a foreign key). The bounded retry around the whole thing is bounded-retry.ts,
// and `observe` is fed from the plan so a losing attempt can advance this scope's counter out of
// band.
//
// TWO WAYS THE SCOPE IS SETTLED, and the register says which (purposes.ts, `scopeSource`). Usually
// it is the scheme's own scoping parts, which is the safe case: the scope key IS the joined
// rendered values of those parts, so two records in different scopes differ in a part the number
// renders and the rendered number cannot collide. Where the DOMAIN decides instead — a time entry
// counts within its matter, an invoice within the letterhead a bill was finalized under — the
// caller passes the key, because neither of those is a value the template renders.

// A purpose with nothing in force and no default: only the matter run can reach this. The caller
// translates it into its own refusal — matters into `scheme-missing` — because the sentence a
// person sees belongs to the route that answers them.
export class NumberingSchemeMissingError extends Error {
  constructor(readonly purpose: SchemeNumberingPurpose) {
    super(`no active numbering scheme is configured for ${purpose}`);
    this.name = "NumberingSchemeMissingError";
  }
}

export interface SchemeDrawOptions {
  /**
   * The counter scope, for a purpose the register marks `scopeSource: "owner"`. Required for those
   * and refused for the others: a caller that could pass a scope to a segments-scoped run would be
   * a second answer to a question the template already answers.
   */
  readonly scopeKey?: string;
  /**
   * How many consecutive numbers this draw consumes. One unless the caller is capturing a block of
   * records on one scope in a single batch.
   */
  readonly count?: number;
  /**
   * The hold a panel was given when it opened (./reservation.ts). Where it is still this scope's,
   * the draw takes exactly that value, so the number the person read while filling the panel in is
   * the number the record is saved under. A hold for another scope — the date was changed after it
   * was taken — is not honoured, and the draw falls through to the next free value.
   */
  readonly reservationToken?: string;
  /**
   * The draw's instant, so a hold left past its lapse can be taken by this record. Without it only
   * values a panel explicitly gave back are taken before the counter moves.
   */
  readonly now?: string;
}

export interface SchemeDrawPlan {
  readonly segments: readonly NumberSegment[];
  /** The counter row this draw counts under. */
  readonly scopeKey: string;
  /** The counter value this draw starts at, as read; the bounded retry's `observe` takes it. */
  readonly observedValue: number;
  readonly startValue: number;
  /** How many values it consumes, which is what the opening statements advance the counter by. */
  readonly count: number;
  /** The rendered numbers, in order. One unless this is a block. */
  readonly numbers: readonly string[];
  /** The first rendered number, which is the whole of it for a draw of one. */
  readonly number: string;
  /**
   * Set where the value came from `number_reservation` rather than the counter: a hold being saved,
   * or a value given back. The opening statements then remove that row instead of advancing the
   * counter, and `observedValue` is that value — always below the counter, so the bounded retry's
   * out-of-band advance, guarded on it, is a no-op.
   */
  readonly reservedFrom?: { readonly purpose: SchemeNumberingPurpose };
}

// A value this scope holds in `number_reservation` that a draw of one may take: the caller's own hold
// first, then the lowest value nobody holds any more. Undefined sends the draw to the counter.
async function reservedValueFor(
  database: SqlDatabase,
  purpose: SchemeNumberingPurpose,
  tables: SequenceNumberingTables,
  scopeKey: string,
  options: SchemeDrawOptions,
  render: (value: number) => string,
): Promise<number | undefined> {
  if (options.reservationToken !== undefined) {
    const held = await readReservationByToken(database, options.reservationToken);
    if (
      held !== undefined &&
      held.purpose === purpose &&
      held.scope_key === scopeKey &&
      !(await isValueAllocated(
        database,
        tables,
        scopeKey,
        held.drawn_value,
        render(held.drawn_value),
      ))
    ) {
      return held.drawn_value;
    }
  }
  for (const value of await readReclaimableValues(database, purpose, scopeKey, options.now, 8)) {
    if (!(await isValueAllocated(database, tables, scopeKey, value, render(value)))) {
      return value;
    }
  }
  return undefined;
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
  options: SchemeDrawOptions = {},
): Promise<SchemeDrawPlan> {
  const definition = schemePurposeOf(purpose);
  const segments = await loadSchemeForDraw(database, purpose);
  if (definition.scopeSource === "owner" && options.scopeKey === undefined) {
    throw new Error(`the ${purpose} numbering run counts within a scope its caller supplies`);
  }
  const scopeKey = options.scopeKey ?? definition.scopePrefix + deriveScopeKey(segments, context);
  const startValue = startValueOf(segments);
  const count = options.count ?? 1;
  // A block reads the counter once and consumes consecutive values, so it never takes a held one:
  // a value given back waits for the next single draw in its scope.
  const reserved =
    count === 1
      ? await reservedValueFor(database, purpose, tables, scopeKey, options, (value) =>
          renderNumber(segments, context, value),
        )
      : undefined;
  if (reserved !== undefined) {
    const number = renderNumber(segments, context, reserved);
    return {
      segments,
      scopeKey,
      observedValue: reserved,
      startValue,
      count,
      numbers: [number],
      number,
      reservedFrom: { purpose },
    };
  }
  const observedValue = (await readCounterValue(database, tables, scopeKey)) ?? startValue;
  const numbers = Array.from({ length: count }, (_unused, offset) =>
    renderNumber(segments, context, observedValue + offset),
  );
  return {
    segments,
    scopeKey,
    observedValue,
    startValue,
    count,
    numbers,
    number: numbers[0] ?? "",
  };
}

// The statements that open the draw: the counter row if it is the scope's first draw, then the
// guarded advance by what this draw consumes. Composed FIRST in the consumer's batch. The guard
// aborts nothing on its own — the allocation row the consumer composes last is the load-bearing
// backstop (counter-statements.ts).
export function schemeDrawOpeningStatements(
  database: SqlDatabase,
  tables: SequenceNumberingTables,
  plan: SchemeDrawPlan,
): SqlStatement[] {
  if (plan.reservedFrom !== undefined) {
    return [
      claimReservedValueStatement(
        database,
        plan.reservedFrom.purpose,
        plan.scopeKey,
        plan.observedValue,
      ),
    ];
  }
  return [
    ensureCounterRowStatement(database, tables, plan.scopeKey, plan.startValue),
    guardedAdvanceStatement(database, tables, plan.scopeKey, plan.observedValue, plan.count),
  ];
}

// The number the next draw would render, without holding it. Panels that create a record hold
// theirs instead (./reservation.ts); this stays for the screens that only show what is coming. A record a person quotes
// out loud is identified before it is saved (docs/conventions/design-corrections.md), so the screen
// that opens a check or logs a packet asks this first. The same plan as a real draw, with nothing
// composed from it.
export async function previewNextNumber(
  database: SqlDatabase,
  purpose: SchemeNumberingPurpose,
  tables: SequenceNumberingTables,
  context: RenderContext,
  options: SchemeDrawOptions = {},
): Promise<string> {
  return (await planSchemeDraw(database, purpose, tables, context, options)).number;
}
