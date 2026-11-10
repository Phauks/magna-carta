/*
 * The search across matters, over the wire: the `search.acrossMatters` operation, reached through
 * the generated client. The contract is generated and diff-gated, and a module mirroring it by
 * hand is a drift surface nothing keeps honest, so the shapes below are the generated ones under
 * the names this surface reads them by.
 *
 * It is generic over the server's registry, like the matter search's call
 * ($lib/matters/matter-search-api.ts): the server decides which places exist, which ones answer
 * across matters and in what order, and this module carries whatever it sends.
 */
import {
  searchAcrossMatters as searchAcrossMattersOperation,
  type SearchAcrossMattersAnswer,
  type SearchAcrossMattersGroup,
  type SearchAcrossMattersHit,
} from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";
import type { SearchReach } from "./search-address.ts";

/**
 * One question's answer. `broad` is true when the words are in more of the firm's records than one
 * search reads; the groups then hold the most recent records with those words, and an empty group
 * has not shown that its place holds none.
 */
export type AcrossMattersAnswer = SearchAcrossMattersAnswer;

/**
 * One place's part of the answer. `skipped` says why a place contributed nothing:
 * `one-matter-only` is a place that is searched inside a matter and not across them, and the rest
 * mean what they mean in a matter's own search. `hasMore` is measured by reading one row past the
 * limit, never estimated.
 */
export type AcrossMattersGroup = SearchAcrossMattersGroup;

/** One record, with the matter it is on and a link into its own section there. */
export type AcrossMattersHit = SearchAcrossMattersHit;

export interface AcrossMattersRequest {
  /** The places to answer from. Empty means every place the member may read. */
  readonly sources: readonly string[];
  readonly limit?: number;
  /** The matters to answer from. Absent means every matter the member may see. */
  readonly reach?: SearchReach;
  /** Aborts a search the reader has already typed past. */
  readonly signal?: AbortSignal;
}

export async function searchAcrossMatters(
  fetchImpl: typeof fetch,
  query: string,
  request: AcrossMattersRequest,
): Promise<ApiOutcome<AcrossMattersAnswer>> {
  try {
    const { data } = await searchAcrossMattersOperation({
      fetch: fetchImpl,
      query: {
        q: query.trim(),
        ...(request.sources.length > 0 ? { in: [...request.sources] } : {}),
        ...(request.limit !== undefined ? { limit: request.limit } : {}),
        ...(request.reach?.kind === "mine" ? { mine: "true" as const } : {}),
        ...(request.reach?.kind === "client" ? { clientEntityId: request.reach.entityId } : {}),
      },
      signal: request.signal,
      throwOnError: true,
    });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}
