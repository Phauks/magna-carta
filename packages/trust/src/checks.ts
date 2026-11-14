import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  TrustAccountId,
  TrustCheckEventId,
  TrustCheckId,
  TrustCheckStockId,
  TrustMovementId,
  UserId,
} from "@magna-carta/identifiers/types";
import { loadTrustAccount, type TrustServiceOptions } from "./account-tree.ts";
import {
  CHECK_PAGE_LAYOUTS,
  MAX_SHIFT_MILS,
  checkFieldListProblem,
  parseCheckFields,
  type CheckField,
  type CheckPageLayout,
} from "./check-layout.ts";
import { liveTrustCheckPredicate } from "./check-statements.ts";
import { TrustValidationError } from "./trust-validation.ts";

export { liveTrustCheckNumberExpression, liveTrustCheckPredicate } from "./check-statements.ts";

// CHECK PRINTING. A disbursement recorded with method `check` and no reference waits to be printed;
// printing numbers it from the account's next number; the person then says whether each sheet came
// out right. Every row here is append-only: the stock is versioned, a check number is used once, and
// what happened to a check is a list of events. Design:
// docs/specs/2026-11-14-trust-check-printing-design.md.
//
// Printing does not move money. The money left the client ledger when the disbursement was approved,
// under the authorization policy; a check is paper that carries that payment to the payee. So voiding
// a check never reverses anything, and nothing here touches the ledger.

const TRUST_CHECK_TABLE = "trust_check";
const TRUST_CHECK_EVENT_TABLE = "trust_check_event";
const TRUST_CHECK_STOCK_TABLE = "trust_check_stock";
const TRUST_MOVEMENT_TABLE = "trust_movement";
const TRUST_LEDGER_NODE_TABLE = "trust_ledger_node";
const MATTER_TABLE = "matter";

/** The most checks one print batch may number: a box of stock is usually 250 sheets. */
export const MAX_TRUST_CHECKS_PER_BATCH = 100;
/** The most rows one register or queue read returns. */
export const MAX_TRUST_CHECK_ROWS = 500;

export type TrustCheckStatus = "numbered" | "printed" | "spoiled" | "voided";

const STATUS_EXPRESSION = `CASE
  WHEN EXISTS (SELECT 1 FROM ${TRUST_CHECK_EVENT_TABLE} e WHERE e.check_id = c.id AND e.kind = 'voided') THEN 'voided'
  WHEN EXISTS (SELECT 1 FROM ${TRUST_CHECK_EVENT_TABLE} e WHERE e.check_id = c.id AND e.kind = 'spoiled') THEN 'spoiled'
  WHEN EXISTS (SELECT 1 FROM ${TRUST_CHECK_EVENT_TABLE} e WHERE e.check_id = c.id AND e.kind = 'printed') THEN 'printed'
  ELSE 'numbered' END`;

const SETTLING_EVENT_COLUMNS = `(SELECT e.reason FROM ${TRUST_CHECK_EVENT_TABLE} e WHERE e.check_id = c.id AND e.kind IN ('spoiled', 'voided') ORDER BY e.recorded_at DESC LIMIT 1) AS settled_reason, (SELECT e.recorded_at FROM ${TRUST_CHECK_EVENT_TABLE} e WHERE e.check_id = c.id ORDER BY e.recorded_at DESC LIMIT 1) AS last_event_at`;

// ---- the stock ---------------------------------------------------------------------------------------

export interface TrustCheckStockSnapshot {
  readonly id: TrustCheckStockId;
  readonly trustAccountId: TrustAccountId;
  readonly version: number;
  readonly name: string;
  readonly pageLayout: CheckPageLayout;
  readonly fields: readonly CheckField[];
  readonly shiftXMils: number;
  readonly shiftYMils: number;
  readonly startingCheckNumber: number;
  readonly scanObjectKey: string | null;
  readonly scanSha256: string | null;
  readonly savedBy: UserId;
  readonly savedAt: string;
}

interface StockRow {
  id: string;
  trust_account_id: string;
  version: number;
  name: string;
  page_layout: CheckPageLayout;
  fields: string;
  shift_x_mils: number;
  shift_y_mils: number;
  starting_check_number: number;
  scan_object_key: string | null;
  scan_sha256: string | null;
  saved_by: string;
  saved_at: string;
}

function parseStoredFields(text: string): readonly CheckField[] {
  const parsed = parseCheckFields(JSON.parse(text));
  if (parsed === null) {
    throw new TrustValidationError(
      "check-stock-unreadable",
      "a stored check layout could not be read",
    );
  }
  return parsed;
}

function toStockSnapshot(row: StockRow): TrustCheckStockSnapshot {
  return {
    id: row.id as TrustCheckStockId,
    trustAccountId: row.trust_account_id as TrustAccountId,
    version: row.version,
    name: row.name,
    pageLayout: row.page_layout,
    fields: parseStoredFields(row.fields),
    shiftXMils: row.shift_x_mils,
    shiftYMils: row.shift_y_mils,
    startingCheckNumber: row.starting_check_number,
    scanObjectKey: row.scan_object_key,
    scanSha256: row.scan_sha256,
    savedBy: row.saved_by as UserId,
    savedAt: row.saved_at,
  };
}

const STOCK_COLUMNS = `id, trust_account_id, version, name, page_layout, fields, shift_x_mils, shift_y_mils, starting_check_number, scan_object_key, scan_sha256, saved_by, saved_at`;

function selectCurrentStockStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${STOCK_COLUMNS} FROM ${TRUST_CHECK_STOCK_TABLE} WHERE trust_account_id = ?1 ORDER BY version DESC LIMIT 1`,
    )
    .bind(trustAccountId);
}

/** The account's current stock, or null when the firm has not set one up. */
export async function readCurrentTrustCheckStock(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): Promise<TrustCheckStockSnapshot | null> {
  const { results } = await selectCurrentStockStatement(database, trustAccountId).all<StockRow>();
  const row = results[0];
  return row ? toStockSnapshot(row) : null;
}

export interface SaveTrustCheckStockInput {
  readonly trustAccountId: TrustAccountId;
  readonly name: string;
  readonly pageLayout: CheckPageLayout;
  readonly fields: readonly CheckField[];
  readonly shiftXMils: number;
  readonly shiftYMils: number;
  readonly startingCheckNumber: number;
  /** The scan this version shows; the caller has already written its bytes to the firm's bucket. */
  readonly scan: { readonly objectKey: string; readonly sha256: string } | null;
  readonly savedBy: UserId;
}

export interface ComposedTrustCheckStock {
  readonly stockId: TrustCheckStockId;
  readonly version: number;
  readonly effect: EffectWrite;
}

/**
 * A saved stock is a new version. The dense-version trigger refuses a second save that read the
 * same last version, so two people saving at once cannot both win.
 */
export async function composeTrustCheckStockSave(
  database: SqlDatabase,
  input: SaveTrustCheckStockInput,
  options: TrustServiceOptions,
): Promise<ComposedTrustCheckStock> {
  await loadTrustAccount(database, input.trustAccountId);
  const name = input.name.trim();
  if (name === "") {
    throw new TrustValidationError("check-stock-invalid", "a check stock needs a name");
  }
  if (!(CHECK_PAGE_LAYOUTS as readonly string[]).includes(input.pageLayout)) {
    throw new TrustValidationError(
      "check-stock-invalid",
      "that page layout is not one this prints",
    );
  }
  const problem = checkFieldListProblem(input.fields);
  if (problem !== null) throw new TrustValidationError("check-stock-invalid", problem);
  for (const shift of [input.shiftXMils, input.shiftYMils]) {
    if (!Number.isInteger(shift) || Math.abs(shift) > MAX_SHIFT_MILS) {
      throw new TrustValidationError(
        "check-stock-invalid",
        "the whole-page shift is at most half an inch either way; past that the stock is set up wrong",
      );
    }
  }
  if (!Number.isSafeInteger(input.startingCheckNumber) || input.startingCheckNumber < 1) {
    throw new TrustValidationError(
      "check-stock-invalid",
      "the starting check number is a whole number from 1",
    );
  }
  const current = await readCurrentTrustCheckStock(database, input.trustAccountId);
  const version = (current?.version ?? 0) + 1;
  const stockId = newIdentifier("trustCheckStock", options.randomSource);
  const statement = database
    .prepare(
      `INSERT INTO ${TRUST_CHECK_STOCK_TABLE} (${STOCK_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    )
    .bind(
      stockId,
      input.trustAccountId,
      version,
      name,
      input.pageLayout,
      JSON.stringify(
        input.fields.map((field) => ({
          kind: field.kind,
          xMils: field.xMils,
          yMils: field.yMils,
          widthMils: field.widthMils,
          sizePoints: field.sizePoints,
          align: field.align,
        })),
      ),
      input.shiftXMils,
      input.shiftYMils,
      input.startingCheckNumber,
      input.scan?.objectKey ?? null,
      input.scan?.sha256 ?? null,
      input.savedBy,
      options.clock.now(),
    );
  return { stockId, version, effect: { statements: [statement], outboxMessages: [] } };
}

// ---- the next number ---------------------------------------------------------------------------------

/**
 * The number the next check on this account takes: the greater of the stock's starting number and
 * one past the highest number ever used. A starting number below a used one is ignored, so a number
 * is never used twice, and a void keeps its number.
 */
export async function readNextTrustCheckNumber(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  stock: TrustCheckStockSnapshot | null,
): Promise<number> {
  const { results } = await database
    .prepare(
      `SELECT MAX(check_number) AS highest FROM ${TRUST_CHECK_TABLE} WHERE trust_account_id = ?1`,
    )
    .bind(trustAccountId)
    .all<{ highest: number | null }>();
  const highest = results[0]?.highest ?? 0;
  return Math.max(stock?.startingCheckNumber ?? 1, highest + 1);
}

// ---- the queue -----------------------------------------------------------------------------------------

export interface TrustCheckToPrint {
  readonly movementId: TrustMovementId;
  readonly payee: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly purpose: string;
  readonly effectiveDate: string;
  readonly authorizedBy: UserId | null;
  readonly recordedAt: string;
  readonly matterNumber: string | null;
  readonly matterTitle: string | null;
  /** Checks for this payment that were spoiled or voided before, newest first. */
  readonly earlierCheckNumbers: readonly number[];
}

interface QueueRow {
  movement_id: string;
  payee: string;
  amount_minor: number;
  currency: string;
  purpose: string;
  effective_date: string;
  authorized_by: string | null;
  recorded_at: string;
  matter_number: string | null;
  matter_title: string | null;
  earlier_numbers: string | null;
}

/**
 * The payments waiting for a check: disbursements on this account paid by check, with no number
 * typed by hand (a hand-written check is recorded with its number and never queued), and no live
 * check. Derived, not stored: every path that records a disbursement feeds it with no change.
 */
function selectQueueStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  movementIds: readonly TrustMovementId[] | null,
): SqlStatement {
  const narrowing =
    movementIds === null
      ? ""
      : ` AND m.id IN (${movementIds.map((_id, index) => `?${index + 3}`).join(", ")})`;
  return database
    .prepare(
      `SELECT m.id AS movement_id, m.counterparty_name AS payee, m.amount_minor AS amount_minor, m.currency AS currency, m.purpose AS purpose, m.effective_date AS effective_date, m.authorized_by AS authorized_by, m.recorded_at AS recorded_at, mt.matter_number AS matter_number, mt.title AS matter_title, (SELECT GROUP_CONCAT(old.check_number) FROM (SELECT check_number FROM ${TRUST_CHECK_TABLE} WHERE movement_id = m.id ORDER BY check_number DESC) old) AS earlier_numbers FROM ${TRUST_MOVEMENT_TABLE} m LEFT JOIN ${TRUST_LEDGER_NODE_TABLE} n ON n.id = m.node_id LEFT JOIN ${MATTER_TABLE} mt ON mt.id = n.matter_id WHERE m.trust_account_id = ?1 AND m.kind = 'disbursement' AND m.method = 'check' AND (m.reference IS NULL OR TRIM(m.reference) = '') AND NOT EXISTS (SELECT 1 FROM ${TRUST_CHECK_TABLE} c WHERE c.movement_id = m.id AND ${liveTrustCheckPredicate("c")})${narrowing} ORDER BY m.effective_date, m.recorded_at, m.id LIMIT ?2`,
    )
    .bind(trustAccountId, MAX_TRUST_CHECK_ROWS, ...(movementIds ?? []));
}

function toQueueItem(row: QueueRow): TrustCheckToPrint {
  return {
    movementId: row.movement_id as TrustMovementId,
    payee: row.payee,
    amountMinor: row.amount_minor,
    currency: row.currency,
    purpose: row.purpose,
    effectiveDate: row.effective_date,
    authorizedBy: row.authorized_by as UserId | null,
    recordedAt: row.recorded_at,
    matterNumber: row.matter_number,
    matterTitle: row.matter_title,
    earlierCheckNumbers:
      row.earlier_numbers === null || row.earlier_numbers === ""
        ? []
        : row.earlier_numbers.split(",").map(Number),
  };
}

export async function readTrustChecksToPrint(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): Promise<readonly TrustCheckToPrint[]> {
  const { results } = await selectQueueStatement(database, trustAccountId, null).all<QueueRow>();
  return results.map(toQueueItem);
}

// ---- the register ----------------------------------------------------------------------------------------

export interface TrustCheckRegisterRow {
  readonly checkId: TrustCheckId;
  readonly checkNumber: number;
  readonly status: TrustCheckStatus;
  readonly movementId: TrustMovementId | null;
  readonly payee: string | null;
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly effectiveDate: string | null;
  readonly matterNumber: string | null;
  readonly matterTitle: string | null;
  readonly memo: string | null;
  readonly stockId: TrustCheckStockId | null;
  readonly numberedBy: UserId;
  readonly numberedAt: string;
  /** Why it was spoiled or voided, as the person wrote it; null while it is live. */
  readonly settledReason: string | null;
  readonly lastEventAt: string | null;
}

interface RegisterRow {
  id: string;
  check_number: number;
  status: TrustCheckStatus;
  movement_id: string | null;
  payee: string | null;
  amount_minor: number | null;
  currency: string | null;
  effective_date: string | null;
  matter_number: string | null;
  matter_title: string | null;
  memo: string | null;
  stock_id: string | null;
  numbered_by: string;
  numbered_at: string;
  settled_reason: string | null;
  last_event_at: string | null;
}

function toRegisterRow(row: RegisterRow): TrustCheckRegisterRow {
  return {
    checkId: row.id as TrustCheckId,
    checkNumber: row.check_number,
    status: row.status,
    movementId: row.movement_id as TrustMovementId | null,
    payee: row.payee,
    amountMinor: row.amount_minor,
    currency: row.currency,
    effectiveDate: row.effective_date,
    matterNumber: row.matter_number,
    matterTitle: row.matter_title,
    memo: row.memo,
    stockId: row.stock_id as TrustCheckStockId | null,
    numberedBy: row.numbered_by as UserId,
    numberedAt: row.numbered_at,
    settledReason: row.settled_reason,
    lastEventAt: row.last_event_at,
  };
}

const REGISTER_SELECT = `SELECT c.id AS id, c.check_number AS check_number, ${STATUS_EXPRESSION} AS status, c.movement_id AS movement_id, c.payee AS payee, c.amount_minor AS amount_minor, c.currency AS currency, c.effective_date AS effective_date, mt.matter_number AS matter_number, mt.title AS matter_title, m.purpose AS memo, c.stock_id AS stock_id, c.numbered_by AS numbered_by, c.numbered_at AS numbered_at, ${SETTLING_EVENT_COLUMNS} FROM ${TRUST_CHECK_TABLE} c LEFT JOIN ${TRUST_MOVEMENT_TABLE} m ON m.id = c.movement_id LEFT JOIN ${TRUST_LEDGER_NODE_TABLE} n ON n.id = m.node_id LEFT JOIN ${MATTER_TABLE} mt ON mt.id = n.matter_id`;

export interface TrustCheckRegisterRange {
  /** Inclusive civil dates on the check's printed date; a voided unprinted number has none and is
   * included by the date it was numbered. Omit both for the newest checks on the account. */
  readonly fromDate?: string;
  readonly toDate?: string;
}

/**
 * THE check register: every number used on the account, with its status. The Checks screen reads it,
 * and so does the reconciliation report's check register section, so the two cannot disagree about
 * which checks exist or which were voided.
 */
export async function readTrustCheckRegister(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  range: TrustCheckRegisterRange = {},
): Promise<readonly TrustCheckRegisterRow[]> {
  const from = range.fromDate ?? "0000-01-01";
  const to = range.toDate ?? "9999-12-31";
  const { results } = await database
    .prepare(
      `${REGISTER_SELECT} WHERE c.trust_account_id = ?1 AND COALESCE(c.effective_date, SUBSTR(c.numbered_at, 1, 10)) BETWEEN ?2 AND ?3 ORDER BY c.check_number DESC LIMIT ?4`,
    )
    .bind(trustAccountId, from, to, MAX_TRUST_CHECK_ROWS)
    .all<RegisterRow>();
  return results.map(toRegisterRow);
}

async function readRegisterRowsById(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  checkIds: readonly TrustCheckId[],
): Promise<readonly TrustCheckRegisterRow[]> {
  if (checkIds.length === 0) return [];
  const { results } = await database
    .prepare(
      `${REGISTER_SELECT} WHERE c.trust_account_id = ?1 AND c.id IN (${checkIds.map((_id, index) => `?${index + 2}`).join(", ")})`,
    )
    .bind(trustAccountId, ...checkIds)
    .all<RegisterRow>();
  return results.map(toRegisterRow);
}

// ---- printing --------------------------------------------------------------------------------------------

export interface TrustCheckPrintInput {
  readonly trustAccountId: TrustAccountId;
  readonly movementIds: readonly TrustMovementId[];
  readonly numberedBy: UserId;
}

export interface NumberedTrustCheck {
  readonly checkId: TrustCheckId;
  readonly checkNumber: number;
  readonly item: TrustCheckToPrint;
}

export interface ComposedTrustCheckPrint {
  readonly stock: TrustCheckStockSnapshot;
  readonly checks: readonly NumberedTrustCheck[];
  readonly effect: EffectWrite;
}

/**
 * Number the chosen payments, in the order given, from the account's next number. The numbers and
 * the rows are one batch; the unique index on (account, number) refuses a second batch that read the
 * same next number, and the caller retries once on that conflict.
 */
export async function composeTrustCheckPrint(
  database: SqlDatabase,
  input: TrustCheckPrintInput,
  options: TrustServiceOptions,
): Promise<ComposedTrustCheckPrint> {
  await loadTrustAccount(database, input.trustAccountId);
  if (input.movementIds.length === 0) {
    throw new TrustValidationError("check-print-empty", "choose at least one payment to print");
  }
  if (input.movementIds.length > MAX_TRUST_CHECKS_PER_BATCH) {
    throw new TrustValidationError(
      "check-print-too-many",
      `print at most ${MAX_TRUST_CHECKS_PER_BATCH} checks at once`,
    );
  }
  if (new Set(input.movementIds).size !== input.movementIds.length) {
    throw new TrustValidationError(
      "check-print-duplicate",
      "a payment is named twice in one batch",
    );
  }
  const stock = await readCurrentTrustCheckStock(database, input.trustAccountId);
  if (stock === null) {
    throw new TrustValidationError(
      "check-stock-missing",
      "set up this account's check stock before printing, so each field lands where your paper expects it",
    );
  }
  const { results } = await selectQueueStatement(
    database,
    input.trustAccountId,
    input.movementIds,
  ).all<QueueRow>();
  const waiting = new Map(results.map((row) => [row.movement_id, toQueueItem(row)]));
  for (const movementId of input.movementIds) {
    if (!waiting.has(movementId)) {
      throw new TrustValidationError(
        "check-not-waiting",
        `${movementId} is not waiting for a check on this account: it is not a check payment, it has a number already, or it was printed`,
      );
    }
  }
  const first = await readNextTrustCheckNumber(database, input.trustAccountId, stock);
  const numberedAt = options.clock.now();
  const checks: NumberedTrustCheck[] = input.movementIds.map((movementId, index) => ({
    checkId: newIdentifier("trustCheck", options.randomSource),
    checkNumber: first + index,
    item: waiting.get(movementId) as TrustCheckToPrint,
  }));
  const statements = checks.map((check) =>
    database
      .prepare(
        `INSERT INTO ${TRUST_CHECK_TABLE} (id, trust_account_id, check_number, movement_id, stock_id, payee, amount_minor, currency, effective_date, numbered_by, numbered_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      )
      .bind(
        check.checkId,
        input.trustAccountId,
        check.checkNumber,
        check.item.movementId,
        stock.id,
        check.item.payee,
        check.item.amountMinor,
        check.item.currency,
        check.item.effectiveDate,
        input.numberedBy,
        numberedAt,
      ),
  );
  return { stock, checks, effect: { statements, outboxMessages: [] } };
}

/** Whether a failed batch lost the race for its numbers, so the caller should read again and retry. */
export function isTrustCheckNumberConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes(
      "UNIQUE constraint failed: trust_check.trust_account_id, trust_check.check_number",
    ) || message.includes("trust_check_account_number_unique_index")
  );
}

// ---- answering, voiding ----------------------------------------------------------------------------------

export type TrustCheckOutcome = "printed" | "spoiled";

export interface TrustCheckResultInput {
  readonly trustAccountId: TrustAccountId;
  readonly results: readonly {
    readonly checkId: TrustCheckId;
    readonly outcome: TrustCheckOutcome;
    readonly reason?: string | null;
  }[];
  readonly recordedBy: UserId;
}

export interface ComposedTrustCheckEvents {
  readonly eventIds: readonly TrustCheckEventId[];
  readonly effect: EffectWrite;
}

function eventStatement(
  database: SqlDatabase,
  row: {
    id: TrustCheckEventId;
    checkId: TrustCheckId;
    kind: "printed" | "spoiled" | "voided";
    reason: string | null;
    recordedBy: UserId;
    recordedAt: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TRUST_CHECK_EVENT_TABLE} (id, check_id, kind, reason, recorded_by, recorded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(row.id, row.checkId, row.kind, row.reason, row.recordedBy, row.recordedAt);
}

/** The default reason a spoiled check carries when the person gives none. */
export const SPOILED_IN_PRINTING = "Spoiled in printing";

/**
 * The answer to "did they print?": each check numbered in a batch is confirmed printed or spoiled. A
 * spoiled check keeps its number in the register and its payment returns to the queue. The trigger
 * refuses an answer to a check that was already answered.
 */
export async function composeTrustCheckResults(
  database: SqlDatabase,
  input: TrustCheckResultInput,
  options: TrustServiceOptions,
): Promise<ComposedTrustCheckEvents> {
  if (input.results.length === 0) {
    throw new TrustValidationError("check-result-empty", "answer for at least one check");
  }
  if (input.results.length > MAX_TRUST_CHECKS_PER_BATCH) {
    throw new TrustValidationError(
      "check-print-too-many",
      `answer for at most ${MAX_TRUST_CHECKS_PER_BATCH} checks at once`,
    );
  }
  const rows = await readRegisterRowsById(
    database,
    input.trustAccountId,
    input.results.map((result) => result.checkId),
  );
  const byId = new Map(rows.map((row) => [row.checkId, row]));
  const recordedAt = options.clock.now();
  const eventIds: TrustCheckEventId[] = [];
  const statements: SqlStatement[] = [];
  for (const result of input.results) {
    const row = byId.get(result.checkId);
    if (row === undefined) {
      throw new TrustValidationError(
        "unknown-trust-check",
        `no such check on this account: ${result.checkId}`,
      );
    }
    if (row.status !== "numbered") {
      throw new TrustValidationError(
        "check-already-answered",
        `check ${row.checkNumber} is already ${row.status}`,
      );
    }
    const id = newIdentifier("trustCheckEvent", options.randomSource);
    eventIds.push(id);
    statements.push(
      eventStatement(database, {
        id,
        checkId: result.checkId,
        kind: result.outcome,
        reason: result.outcome === "spoiled" ? result.reason?.trim() || SPOILED_IN_PRINTING : null,
        recordedBy: input.recordedBy,
        recordedAt,
      }),
    );
  }
  return { eventIds, effect: { statements, outboxMessages: [] } };
}

export interface TrustCheckVoidInput {
  readonly trustAccountId: TrustAccountId;
  readonly checkId: TrustCheckId;
  readonly reason: string;
  readonly recordedBy: UserId;
}

/**
 * Void a check: lost, stale, stopped, or never sent. The number stays in the register and the
 * payment returns to the queue for a replacement. Voiding never reverses the payment; cancelling the
 * payment itself is a trust movement under the authorization policy.
 */
export async function composeTrustCheckVoid(
  database: SqlDatabase,
  input: TrustCheckVoidInput,
  options: TrustServiceOptions,
): Promise<ComposedTrustCheckEvents> {
  const reason = input.reason.trim();
  if (reason === "") {
    throw new TrustValidationError("check-void-reason-missing", "say why the check is voided");
  }
  const [row] = await readRegisterRowsById(database, input.trustAccountId, [input.checkId]);
  if (row === undefined) {
    throw new TrustValidationError(
      "unknown-trust-check",
      `no such check on this account: ${input.checkId}`,
    );
  }
  if (row.status === "spoiled" || row.status === "voided") {
    throw new TrustValidationError(
      "check-already-answered",
      `check ${row.checkNumber} is already ${row.status}`,
    );
  }
  const id = newIdentifier("trustCheckEvent", options.randomSource);
  return {
    eventIds: [id],
    effect: {
      statements: [
        eventStatement(database, {
          id,
          checkId: input.checkId,
          kind: "voided",
          reason,
          recordedBy: input.recordedBy,
          recordedAt: options.clock.now(),
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface TrustCheckNumberVoidInput {
  readonly trustAccountId: TrustAccountId;
  readonly reason: string;
  readonly recordedBy: UserId;
}

export interface ComposedTrustCheckNumberVoid {
  readonly checkId: TrustCheckId;
  readonly checkNumber: number;
  readonly effect: EffectWrite;
}

/**
 * Void the next unused number with no payment: a sheet torn or lost before it was printed. The
 * register then matches the paper again, and the next print takes the number after it.
 */
export async function composeTrustCheckNumberVoid(
  database: SqlDatabase,
  input: TrustCheckNumberVoidInput,
  options: TrustServiceOptions,
): Promise<ComposedTrustCheckNumberVoid> {
  await loadTrustAccount(database, input.trustAccountId);
  const reason = input.reason.trim();
  if (reason === "") {
    throw new TrustValidationError("check-void-reason-missing", "say why the number is voided");
  }
  const stock = await readCurrentTrustCheckStock(database, input.trustAccountId);
  const checkNumber = await readNextTrustCheckNumber(database, input.trustAccountId, stock);
  const checkId = newIdentifier("trustCheck", options.randomSource);
  const now = options.clock.now();
  return {
    checkId,
    checkNumber,
    effect: {
      statements: [
        database
          .prepare(
            `INSERT INTO ${TRUST_CHECK_TABLE} (id, trust_account_id, check_number, movement_id, stock_id, payee, amount_minor, currency, effective_date, numbered_by, numbered_at) VALUES (?1, ?2, ?3, NULL, NULL, NULL, NULL, NULL, NULL, ?4, ?5)`,
          )
          .bind(checkId, input.trustAccountId, checkNumber, input.recordedBy, now),
        eventStatement(database, {
          id: newIdentifier("trustCheckEvent", options.randomSource),
          checkId,
          kind: "voided",
          reason,
          recordedBy: input.recordedBy,
          recordedAt: now,
        }),
      ],
      outboxMessages: [],
    },
  };
}

// ---- fitness ---------------------------------------------------------------------------------------------

/**
 * Payments with more than one live check. The composer refuses a batch naming a payment that has
 * one, but the status lives in events, so no index can hold it; this re-proves it over stored rows.
 */
export async function readTrustPaymentsWithTwoLiveChecks(
  database: SqlDatabase,
): Promise<readonly TrustMovementId[]> {
  const { results } = await database
    .prepare(
      `SELECT c.movement_id AS movement_id FROM ${TRUST_CHECK_TABLE} c WHERE c.movement_id IS NOT NULL AND ${liveTrustCheckPredicate("c")} GROUP BY c.movement_id HAVING COUNT(*) > 1 LIMIT 100`,
    )
    .all<{ movement_id: string }>();
  return results.map((row) => row.movement_id as TrustMovementId);
}
