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
 */
import { firmSearchStatusGet } from "@magna-carta/api-client";
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
