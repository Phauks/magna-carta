/*
 * The matter's Bates numbers over the wire: the `bates.*` operations, reached through the generated
 * client. A matter keeps several Bates logs, one per filing or production; every stamp takes its
 * range from one of them before it stamps, so two documents in a log never share a number, and
 * records the saved copy after.
 *
 * Every write carries a fresh idempotency key: a retried take answers the range it took rather than
 * taking a second one.
 */
import {
  batesCreateBatesLog,
  batesListBatesLogs,
  batesListBatesRanges,
  batesRecordBatesStampedFile,
  batesTakeBatesRange,
  type BatesLogRecord,
  type BatesLogSummary,
  type BatesRange,
  type TakenBatesRange,
} from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";

export type { BatesLogRecord, BatesLogSummary, BatesRange, TakenBatesRange };
export type BatesPurpose = BatesRange["purpose"];

/** How far a range list read walks before it stops. */
const MOST_PAGES = 100;

async function attempt<T>(call: () => Promise<{ data: T }>): Promise<ApiOutcome<T>> {
  try {
    const { data } = await call();
    return { kind: "ok", value: data };
  } catch (caught) {
    return outcomeOf<T>(caught);
  }
}

/** The matter's Bates logs, the one used most recently first, each with its next number. */
export async function listBatesLogs(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<BatesLogSummary[]>> {
  const outcome = await attempt(() =>
    batesListBatesLogs({ fetch: fetchImpl, path: { matterId }, throwOnError: true }),
  );
  return outcome.kind === "ok" ? { kind: "ok", value: outcome.value.data } : outcome;
}

export interface NewBatesLog {
  readonly name: string;
  readonly prefix: string;
  readonly digits: number;
}

/** Starts a Bates log on the matter. Refused when another log has the name. */
export function createBatesLog(
  fetchImpl: typeof fetch,
  matterId: string,
  log: NewBatesLog,
): Promise<ApiOutcome<BatesLogRecord>> {
  return attempt(() =>
    batesCreateBatesLog({
      fetch: fetchImpl,
      path: { matterId },
      body: { ...log },
      headers: { "idempotency-key": crypto.randomUUID() },
      throwOnError: true,
    }),
  );
}

/** Every range taken on the matter, newest first. */
export async function listBatesRanges(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<BatesRange[]>> {
  const ranges: BatesRange[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MOST_PAGES; page += 1) {
    const outcome = await attempt(() =>
      batesListBatesRanges({
        fetch: fetchImpl,
        path: { matterId },
        query: cursor === undefined ? {} : { cursor },
        throwOnError: true,
      }),
    );
    if (outcome.kind !== "ok") return outcome;
    ranges.push(...outcome.value.data);
    if (outcome.value.nextCursor === null) break;
    cursor = outcome.value.nextCursor;
  }
  return { kind: "ok", value: ranges };
}

export interface TakeRangeRequest {
  readonly logId: string;
  readonly pageCount: number;
  /** Absent takes the next number in the log. */
  readonly firstNumber?: number;
  readonly purpose: BatesPurpose;
  readonly sourceFileId?: string;
  readonly exhibitSetId?: string;
}

/** Takes the numbers one stamp will print. Refused when any of them is already stamped. */
export function takeBatesRange(
  fetchImpl: typeof fetch,
  matterId: string,
  request: TakeRangeRequest,
): Promise<ApiOutcome<TakenBatesRange>> {
  return attempt(() =>
    batesTakeBatesRange({
      fetch: fetchImpl,
      path: { matterId },
      body: request,
      headers: { "idempotency-key": crypto.randomUUID() },
      throwOnError: true,
    }),
  );
}

/** Records the saved, stamped copy of a range. */
export function recordBatesStampedFile(
  fetchImpl: typeof fetch,
  matterId: string,
  rangeId: string,
  fileId: string,
): Promise<ApiOutcome<{ id: string }>> {
  return attempt(() =>
    batesRecordBatesStampedFile({
      fetch: fetchImpl,
      path: { matterId, rangeId },
      body: { fileId },
      headers: { "idempotency-key": crypto.randomUUID() },
      throwOnError: true,
    }),
  );
}

/** Which log a stamp takes its numbers from: one the matter keeps, or a new one to start. */
export type BatesLogChoice =
  | { readonly kind: "log"; readonly log: BatesLogSummary }
  | {
      readonly kind: "new";
      readonly name: string;
      readonly prefix: string;
      readonly digits: number;
    };

/** The chosen log, started first when it is a new one. */
export async function resolveBatesLog(
  fetchImpl: typeof fetch,
  matterId: string,
  choice: BatesLogChoice,
): Promise<ApiOutcome<BatesLogRecord>> {
  if (choice.kind === "log") {
    const { id, name, prefix, digits } = choice.log;
    return { kind: "ok", value: { id, name, prefix, digits } };
  }
  return createBatesLog(fetchImpl, matterId, {
    name: choice.name.trim(),
    prefix: choice.prefix,
    digits: choice.digits,
  });
}
