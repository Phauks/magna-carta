import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  ensureCounterRowStatement,
  guardedIncrementStatement,
  readCounterValue,
  type SequenceNumberingTables,
} from "./counter-statements.ts";
import { schemePurposeOf, type SchemeNumberingPurpose } from "./purposes.ts";
import { deriveScopeKey, renderNumber, type RenderContext } from "./render.ts";
import {
  isValueAllocated,
  NUMBER_RESERVATION_TABLE,
  readReclaimableValues,
  readReservationByToken,
} from "./reservation-statements.ts";
import { loadSchemeForDraw } from "./scheme-draw.ts";
import { startValueOf } from "./segments.ts";

// THE DRAFT NUMBER: a value held for a panel that is still being filled in, and given back if the
// panel closes without saving. The owner's ruling of 2026-11-14 replaced the preview the panels
// showed before ("A number is drawn when this is saved.") with the number itself, held, and asked
// that a cancelled panel leave no gap in the run.
//
// THE LIFECYCLE, in four calls a panel makes:
//   - `holdNumber` with no token when the panel opens: takes the lowest value nobody holds in the
//     scope (given back, or held past its lapse), else moves the counter one past a new value.
//   - `holdNumber` with its token while the panel stays open, and whenever its scope changes (a
//     call's date): the same value is kept and its lapse pushed out, or — if the scope moved — it is
//     given back and a value in the new scope is held instead.
//   - the record's own create, carrying the token: the draw planner takes exactly the held value and
//     removes the hold in the record's batch (./scheme-draw.ts).
//   - `releaseNumber` when the panel is cancelled. A panel closed by a crash or a lost tab never
//     says so; its hold lapses after HOLD_MINUTES and the next draw in the scope takes it.
//
// WHY NO GAP SURVIVES. A value leaves the counter only into a hold or a record. A hold ends in a
// record, or back in the pool, and the pool is drained lowest-first by the next single draw in the
// scope — a hold or a save alike — before the counter moves again. So a run has a gap only while a
// value is held or waiting, and the next record fills it. What a run does NOT keep is creation
// order: a number given back on Monday may be taken by a record made on Tuesday, after a higher one.
// That is why the invoice run never holds (its register row says `draftNumber: "previewed"`): an
// auditor reads invoice numbers as chronological as well as gapless, and a bill is numbered at
// finalize in one batch with nothing to give back.
//
// TWO PEOPLE AT ONCE. Each hold is its own row under the scope's primary key, so two panels opening
// together read the same counter, both write a hold for the same value, and the second write is
// refused by the key; it steps the counter past that value and re-reads. The counter advance is
// guarded on the value read; a hold whose advance found the counter already moved keeps its value
// unless a record has been saved under it, in which case it is deleted and retried. The one window left is a plain draw (no panel, e.g. an import) that
// read the counter in the same millisecond a hold advanced it: the allocation primary key still
// refuses a duplicate record, and the holder's save is given the next free number instead of the one
// it showed. Nothing is ever numbered twice; at worst a draft number changes at the save.

/** How long a hold stands without its panel renewing it. Panels renew well inside this. */
export const HOLD_MINUTES = 15;

const MAX_HOLD_ATTEMPTS = 5;

export interface HoldRequest {
  readonly purpose: SchemeNumberingPurpose;
  readonly tables: SequenceNumberingTables;
  readonly context: RenderContext;
  readonly holderUserId: string;
  /** The instant of the request, as an ISO-8601 UTC string. */
  readonly now: string;
  /** The panel's current hold, where it has one. */
  readonly token?: string;
  /** Mints a fresh opaque token. The service has no randomness of its own. */
  readonly newToken: () => string;
}

export interface HeldNumber {
  readonly token: string;
  readonly number: string;
  readonly expiresAt: string;
}

function lapseOf(now: string): string {
  return new Date(Date.parse(now) + HOLD_MINUTES * 60_000).toISOString();
}

/** Whether the register lets this purpose hold a draft number. */
export function purposeHoldsDraftNumbers(purpose: SchemeNumberingPurpose): boolean {
  const definition = schemePurposeOf(purpose);
  return definition.draftNumber === "held" && definition.scopeSource === "segments";
}

export class DraftNumberNotHeldError extends Error {
  constructor(readonly purpose: SchemeNumberingPurpose) {
    super(`the ${purpose} run does not hold draft numbers`);
    this.name = "DraftNumberNotHeldError";
  }
}

// Holds a draft number for one panel, or keeps the one it holds. Throws NumberingSchemeMissingError
// (nothing in force for the matter run), NumberingRenderError (the context lacks a part the scheme
// needs) and DraftNumberNotHeldError (the register keeps this run previewed).
export async function holdNumber(database: SqlDatabase, request: HoldRequest): Promise<HeldNumber> {
  const { purpose, tables, context, holderUserId, now } = request;
  if (!purposeHoldsDraftNumbers(purpose)) throw new DraftNumberNotHeldError(purpose);
  const definition = schemePurposeOf(purpose);
  const segments = await loadSchemeForDraw(database, purpose);
  const scopeKey = definition.scopePrefix + deriveScopeKey(segments, context);
  const expiresAt = lapseOf(now);

  if (request.token !== undefined) {
    const held = await readReservationByToken(database, request.token);
    if (held !== undefined && held.holder_user_id === holderUserId) {
      if (
        held.purpose === purpose &&
        held.scope_key === scopeKey &&
        !(await isValueAllocated(
          database,
          tables,
          scopeKey,
          held.drawn_value,
          renderNumber(segments, context, held.drawn_value),
        ))
      ) {
        await database
          .prepare(`UPDATE ${NUMBER_RESERVATION_TABLE} SET expires_at = ?2 WHERE token = ?1`)
          .bind(request.token, expiresAt)
          .run();
        return {
          token: request.token,
          number: renderNumber(segments, context, held.drawn_value),
          expiresAt,
        };
      }
      await releaseNumber(database, request.token, holderUserId);
    }
  }

  const token = request.newToken();

  // A value nobody holds any more, lowest first. The claim is one guarded statement, so two panels
  // reaching for the same given-back value cannot both take it: the loser changes nothing and moves
  // to the next candidate.
  for (const value of await readReclaimableValues(database, purpose, scopeKey, now, 8)) {
    if (
      await isValueAllocated(
        database,
        tables,
        scopeKey,
        value,
        renderNumber(segments, context, value),
      )
    ) {
      await database
        .prepare(
          `DELETE FROM ${NUMBER_RESERVATION_TABLE} WHERE purpose = ?1 AND scope_key = ?2 AND drawn_value = ?3`,
        )
        .bind(purpose, scopeKey, value)
        .run();
      continue;
    }
    const claimed = await database
      .prepare(
        `UPDATE ${NUMBER_RESERVATION_TABLE} SET token = ?4, holder_user_id = ?5, reserved_at = ?6, expires_at = ?7 WHERE purpose = ?1 AND scope_key = ?2 AND drawn_value = ?3 AND (token IS NULL OR expires_at < ?6)`,
      )
      .bind(purpose, scopeKey, value, token, holderUserId, now, expiresAt)
      .run();
    if (claimed.meta.changes === 1) {
      return { token, number: renderNumber(segments, context, value), expiresAt };
    }
  }

  // A fresh value from the counter. The hold is written FIRST and the counter advanced after, so a
  // failure between the two leaves a hold that lapses back into the pool rather than a value the
  // counter has passed with nothing pointing at it.
  const startValue = startValueOf(segments);
  for (let attempt = 0; attempt < MAX_HOLD_ATTEMPTS; attempt += 1) {
    const observedValue = (await readCounterValue(database, tables, scopeKey)) ?? startValue;
    try {
      await database
        .prepare(
          `INSERT INTO ${NUMBER_RESERVATION_TABLE} (purpose, scope_key, drawn_value, token, holder_user_id, reserved_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        )
        .bind(purpose, scopeKey, observedValue, token, holderUserId, now, expiresAt)
        .run();
    } catch (caught) {
      // Another panel holds this value already: it won the read. Advance past it and read again.
      if (caught instanceof Error && caught.message.includes("UNIQUE constraint failed")) {
        await ensureCounterRowStatement(database, tables, scopeKey, startValue).run();
        await guardedIncrementStatement(database, tables, scopeKey, observedValue).run();
        continue;
      }
      throw caught;
    }
    await ensureCounterRowStatement(database, tables, scopeKey, startValue).run();
    const advanced = await guardedIncrementStatement(
      database,
      tables,
      scopeKey,
      observedValue,
    ).run();
    const number = renderNumber(segments, context, observedValue);
    if (advanced.meta.changes === 1) return { token, number, expiresAt };
    // Something moved the counter between the read and the advance. Usually it was a panel that
    // lost the race for this same value and stepped the counter past it on our behalf, and the hold
    // is still ours; it is let go only where a plain draw has already saved a record under it.
    const counterNow = (await readCounterValue(database, tables, scopeKey)) ?? startValue;
    if (
      counterNow > observedValue &&
      !(await isValueAllocated(database, tables, scopeKey, observedValue, number))
    ) {
      return { token, number, expiresAt };
    }
    await database
      .prepare(`DELETE FROM ${NUMBER_RESERVATION_TABLE} WHERE token = ?1`)
      .bind(token)
      .run();
  }
  throw new Error(
    `a draft ${purpose} number could not be held after ${MAX_HOLD_ATTEMPTS} attempts in scope ${JSON.stringify(scopeKey)}`,
  );
}

// Gives a held value back, for the next record in its scope. Only the holder can; anybody else's
// token, a token already saved, or one already given back changes nothing.
export async function releaseNumber(
  database: SqlDatabase,
  token: string,
  holderUserId: string,
): Promise<boolean> {
  const released = await database
    .prepare(
      `UPDATE ${NUMBER_RESERVATION_TABLE} SET token = NULL, holder_user_id = NULL, expires_at = NULL WHERE token = ?1 AND holder_user_id = ?2`,
    )
    .bind(token, holderUserId)
    .run();
  return released.meta.changes === 1;
}
