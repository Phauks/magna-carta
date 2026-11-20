/*
 * The File Manager's client for sharing with people outside the firm. One read per matter (every live
 * share, with the person's name) and three writes: share a selection, change one share, stop one.
 * Every call goes through the generated client and resolves to an outcome rather than throwing, and
 * every write takes its idempotency key as a required parameter.
 */
import {
  sharesChange,
  sharesList,
  sharesShare,
  sharesStop,
  type ChangeShareRequest,
  type ShareFilesRequest,
  type ShareSummary,
} from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";

export type { ShareSummary };
export type ShareRole = ShareSummary["role"];
export type ShareTargetInput = ShareFilesRequest["items"][number];

async function attempt<T>(call: () => Promise<{ data: T }>): Promise<ApiOutcome<T>> {
  try {
    const { data } = await call();
    return { kind: "ok", value: data };
  } catch (caught) {
    return outcomeOf<T>(caught);
  }
}

export function listMatterShares(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<{ data: ShareSummary[] }>> {
  return attempt(() => sharesList({ fetch: fetchImpl, path: { matterId }, throwOnError: true }));
}

export function shareItems(
  fetchImpl: typeof fetch,
  matterId: string,
  input: ShareFilesRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<{ shareIds: string[] }>> {
  return attempt(() =>
    sharesShare({
      fetch: fetchImpl,
      path: { matterId },
      body: input,
      headers: { "idempotency-key": idempotencyKey },
      throwOnError: true,
    }),
  );
}

export function changeShare(
  fetchImpl: typeof fetch,
  shareId: string,
  changes: ChangeShareRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return attempt(() =>
    sharesChange({
      fetch: fetchImpl,
      path: { shareId },
      body: changes,
      headers: { "idempotency-key": idempotencyKey },
      throwOnError: true,
    }),
  );
}

export function stopShare(
  fetchImpl: typeof fetch,
  shareId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return attempt(() =>
    sharesStop({
      fetch: fetchImpl,
      path: { shareId },
      headers: { "idempotency-key": idempotencyKey },
      throwOnError: true,
    }),
  );
}
