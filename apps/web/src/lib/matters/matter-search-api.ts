/*
 * The matter's consolidated search: response shapes and the one call. Mirrors the
 * `matterSearch.search` operation in apps/api-worker/openapi/openapi.json; the transport envelope
 * lives in $lib/api/request.ts.
 *
 * It is deliberately generic. Nothing here names a source — the server's registry decides which
 * groups exist and in what order, and this module carries whatever it sends. That is what makes a
 * fifteenth searchable section cost nothing on the client but one presentation entry.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";
import type { TextMark } from "$lib/search/marked-text.ts";

/**
 * Why a source contributed nothing. Null means it answered — with hits or honestly with none.
 * Three belong to a source that reads an index outside the firm's database:
 * "engine-not-connected" is a deployment without the index's service yet, "engine-unavailable" is
 * that service failing to answer, and "not-indexed" is a firm that has not turned the index on.
 */
export type SearchSkipReason =
  | "permission"
  | "query-too-short"
  | "engine-unavailable"
  | "engine-not-connected"
  | "not-indexed";

export interface MatterSearchHit {
  id: string;
  /** What the reader recognizes the record by. A file's name, a party's name, a note's instant. */
  title: string;
  /**
   * Where the reader's words are in `title`, as the server found them. Optional because an answer
   * from a server a deploy behind carries none, and the title is then drawn plain.
   */
  titleMarks?: TextMark[];
  /**
   * The excerpt, where the source declares one. Null where it declares it has none. A long text
   * arrives cut to the stretch the reader's words are in.
   */
  snippet: string | null;
  /** Where the reader's words are in `snippet`. */
  snippetMarks?: TextMark[];
  /** A short second line: a folder, a role, a custody number and status. */
  secondary: string | null;
  actorUserId: string | null;
  sortKey: string;
  /** Into the section that owns the row, behind that section's own access gate. */
  link: string;
}

export interface MatterSearchGroup {
  source: string;
  /** The matter section slug this source's rows live under. */
  section: string;
  answerShape: "listing" | "ranked";
  /** What the source matched on, in the reader's words — rendered so a hit is never a guess. */
  matchedFields: string[];
  /** Whether this source honors `includeDeleted` — what decides if the control is worth offering. */
  supportsDeleted: boolean;
  hits: MatterSearchHit[];
  /** Measured, never estimated: the server read one row past the limit to know. */
  hasMore: boolean;
  skipped: SearchSkipReason | null;
}

export interface MatterSearchAnswer {
  matterId: string;
  query: string;
  /** One per selected source, in the matter's own section order. Never a flat merged list. */
  groups: MatterSearchGroup[];
}

export interface MatterSearchRequest {
  /**
   * The source keys to answer from. An EMPTY array means every source the member may read —
   * there is deliberately no key meaning "everything", because the vocabulary must never grow a
   * word that could be read as wider than this matter.
   */
  readonly sources: readonly string[];
  readonly limit?: number;
  readonly includeDeleted?: boolean;
  /** Aborts a search the reader has already typed past. */
  readonly signal?: AbortSignal;
}

export function searchMatter(
  fetchImpl: typeof fetch,
  matterId: string,
  query: string,
  request: MatterSearchRequest,
): Promise<ApiOutcome<MatterSearchAnswer>> {
  const parameters = new URLSearchParams({ q: query.trim() });
  for (const source of request.sources) parameters.append("in", source);
  if (request.limit !== undefined) parameters.set("limit", String(request.limit));
  if (request.includeDeleted === true) parameters.set("includeDeleted", "true");
  return requestJson(
    fetchImpl,
    `/api/v1/matters/${encodeURIComponent(matterId)}/search?${parameters.toString()}`,
    { signal: request.signal },
  );
}
