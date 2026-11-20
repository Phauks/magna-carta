import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { guarded, type EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { BatesRangeId, ExhibitSetId, FileId, MatterId } from "@magna-carta/identifiers/types";
import { batesRangeLabel } from "./label.ts";
import {
  readNextNumber,
  readOverlappingRange,
  readRangeRow,
  recordStampedFileStatement,
  takeRangeStatement,
  type BatesRangeRow,
} from "./range-statements.ts";
import { DEFAULT_FIRST_NUMBER, type BatesServiceOptions } from "./types.ts";
import {
  BatesValidationError,
  assertDigits,
  assertFirstNumber,
  assertPageCount,
  assertPrefix,
  assertPurpose,
  lastNumberOf,
} from "./validation.ts";

// Taking a range of Bates numbers from a matter's register, and recording the stamped copy once it
// is saved. The register is the `bates_range` rows themselves; see range-statements.ts for why the
// overlap guard, and not a counter, is what keeps two stamps from sharing a number.

/** The guard a lost race, or a hand-typed start inside a stamped range, is refused under. */
export const RANGE_OVERLAP_GUARD = "bates-range-overlap";
/** The guard a second record of the stamped copy is refused under. */
export const STAMPED_FILE_GUARD = "bates-range-stamped-file";

export interface TakeBatesRangeInput {
  readonly matterId: MatterId;
  readonly prefix: unknown;
  readonly digits: unknown;
  readonly pageCount: unknown;
  /** Absent takes the next number under the prefix. */
  readonly firstNumber?: unknown;
  readonly purpose: unknown;
  readonly sourceFileId?: FileId | null;
  readonly exhibitSetId?: ExhibitSetId | null;
}

export interface TakenBatesRange {
  readonly rangeId: BatesRangeId;
  readonly prefix: string;
  readonly digits: number;
  readonly firstNumber: number;
  readonly lastNumber: number;
}

async function assertFileOnMatter(
  database: SqlDatabase,
  matterId: MatterId,
  fileId: FileId,
): Promise<void> {
  const { results } = await database
    .prepare(`SELECT matter_id FROM file WHERE id = ?1 AND deleted_at IS NULL`)
    .bind(fileId)
    .all<{ matter_id: MatterId }>();
  if (results[0]?.matter_id !== matterId) {
    throw new BatesValidationError("bates-unknown-file", "no such file on this matter");
  }
}

async function assertSetOnMatter(
  database: SqlDatabase,
  matterId: MatterId,
  setId: ExhibitSetId,
): Promise<void> {
  const { results } = await database
    .prepare(`SELECT matter_id FROM exhibit_set WHERE id = ?1`)
    .bind(setId)
    .all<{ matter_id: MatterId }>();
  if (results[0]?.matter_id !== matterId) {
    throw new BatesValidationError("bates-unknown-set", "no such exhibit set on this matter");
  }
}

export async function takeBatesRange(
  database: SqlDatabase,
  input: TakeBatesRangeInput,
  options: BatesServiceOptions,
): Promise<{ range: TakenBatesRange; effect: EffectWrite }> {
  const prefix = assertPrefix(input.prefix);
  const digits = assertDigits(input.digits);
  const pageCount = assertPageCount(input.pageCount);
  const purpose = assertPurpose(input.purpose);
  const sourceFileId = input.sourceFileId ?? null;
  const exhibitSetId = input.exhibitSetId ?? null;
  if (sourceFileId !== null) await assertFileOnMatter(database, input.matterId, sourceFileId);
  if (exhibitSetId !== null) await assertSetOnMatter(database, input.matterId, exhibitSetId);

  const firstNumber =
    input.firstNumber === undefined || input.firstNumber === null
      ? ((await readNextNumber(database, input.matterId, prefix)) ?? DEFAULT_FIRST_NUMBER)
      : assertFirstNumber(input.firstNumber);
  const lastNumber = lastNumberOf(firstNumber, pageCount);

  // Advisory: names the clash for a hand-typed start. The guard on the insert is what holds.
  const clash = await readOverlappingRange(
    database,
    input.matterId,
    prefix,
    firstNumber,
    lastNumber,
  );
  if (clash !== undefined) {
    const next = (await readNextNumber(database, input.matterId, prefix)) ?? DEFAULT_FIRST_NUMBER;
    throw new BatesValidationError(
      "bates-range-taken",
      `${batesRangeLabel(prefix, clash.first_number, clash.last_number, clash.digits)} is already ` +
        `stamped. The next free number under this prefix is ${String(next)}.`,
    );
  }

  const rangeId = newIdentifier("batesRange", options.randomSource);
  return {
    range: { rangeId, prefix, digits, firstNumber, lastNumber },
    effect: {
      statements: [
        guarded(
          takeRangeStatement(database, {
            id: rangeId,
            matterId: input.matterId,
            prefix,
            digits,
            firstNumber,
            lastNumber,
            purpose,
            sourceFileId,
            exhibitSetId,
            createdBy: options.actorUserId,
            now: options.clock.now(),
          }),
          RANGE_OVERLAP_GUARD,
        ),
        domainAuditStatement(database, {
          event: "batesRange.taken",
          subjectId: rangeId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId: input.matterId, purpose, pageCount },
        }),
      ],
      outboxMessages: [],
    },
  };
}

async function requireRange(
  database: SqlDatabase,
  matterId: MatterId,
  rangeId: BatesRangeId,
): Promise<BatesRangeRow> {
  const range = await readRangeRow(database, rangeId);
  if (range === undefined || range.matter_id !== matterId) {
    throw new BatesValidationError("bates-unknown-range", "no such Bates range on this matter");
  }
  return range;
}

/** Records the saved stamped copy of a range. Once only: a range stamps one document. */
export async function recordStampedFile(
  database: SqlDatabase,
  matterId: MatterId,
  rangeId: BatesRangeId,
  stampedFileId: FileId,
  options: BatesServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const range = await requireRange(database, matterId, rangeId);
  if (range.stamped_file_id !== null) {
    throw new BatesValidationError(
      "bates-range-already-saved",
      "this range's stamped copy is already recorded",
    );
  }
  await assertFileOnMatter(database, matterId, stampedFileId);
  return {
    effect: {
      statements: [
        guarded(
          recordStampedFileStatement(database, rangeId, stampedFileId, options.clock.now()),
          STAMPED_FILE_GUARD,
        ),
        domainAuditStatement(database, {
          event: "batesRange.saved",
          subjectId: rangeId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId, stampedFileId },
        }),
      ],
      outboxMessages: [],
    },
  };
}
