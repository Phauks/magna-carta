/*
 * What the firm's search indexes hold, over the wire: one read of GET /api/v1/firm/search-status,
 * behind `firm:manageSearchSettings`, the permission the settings beside it name.
 *
 * The `firmSearchStatus.get` operation, reached through the generated client for the reason the
 * settings read is: the contract is generated and diff-gated, and a module mirroring it by hand is
 * a drift surface nothing keeps honest.
 *
 * NOT FOR POLLING. The server counts every indexed record and every live file to answer, so the
 * page asks once when it opens and again only when somebody presses the button that says so.
 *
 * AND ONE WRITE: asking for the places that are behind to be rebuilt (`firmSearchStatus.rebuild`).
 * It names no place. The server records that this member asked and answers at once; the rebuild
 * runs afterwards, counts what is behind when it runs and takes those places. The answer is only
 * the moment the request was recorded.
 */
import { firmSearchStatusGet, firmSearchStatusRebuild } from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";
import type { SearchStatus } from "./search-status.ts";

export async function readSearchStatus(fetchImpl: typeof fetch): Promise<ApiOutcome<SearchStatus>> {
  try {
    const { data } = await firmSearchStatusGet({ fetch: fetchImpl, throwOnError: true });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

/** Asks for the places that are behind to be rebuilt. Answers when the request was recorded. */
export async function requestSearchIndexRebuild(
  fetchImpl: typeof fetch,
  idempotencyKey: string,
): Promise<ApiOutcome<{ requestedAt: string }>> {
  try {
    const { data } = await firmSearchStatusRebuild({
      fetch: fetchImpl,
      headers: { "idempotency-key": idempotencyKey },
      throwOnError: true,
    });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}
