/*
 * The matter's Bates numbers over the wire: the `bates.*` operations, reached through the generated
 * client. Every stamp takes its range here before it stamps, so two documents stamped on one matter
 * under one prefix never share a number, and records the saved copy after.
 *
 * Every write carries a fresh idempotency key: a retried take answers the range it took rather than
 * taking a second one.
 */
import {
  batesListBatesPrefixes,
  batesListBatesRanges,
  batesRecordBatesStampedFile,
  batesTakeBatesRange,
  type BatesPrefixSummary,
  type BatesRange,
  type TakenBatesRange,
} from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";

export type { BatesPrefixSummary, BatesRange, TakenBatesRange };
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

/** Each prefix stamped on the matter, most recently used first, with its next number. */
export async function listBatesPrefixes(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<BatesPrefixSummary[]>> {
  const outcome = await attempt(() =>
    batesListBatesPrefixes({ fetch: fetchImpl, path: { matterId }, throwOnError: true }),
  );
  return outcome.kind === "ok" ? { kind: "ok", value: outcome.value.data } : outcome;
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
  readonly prefix: string;
  readonly digits: number;
  readonly pageCount: number;
  /** Absent takes the next number under the prefix. */
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
