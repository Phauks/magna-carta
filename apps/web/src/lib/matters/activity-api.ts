/*
 * The matter's activity read. Mirrors the `calendar.matterTimeline` operation in
 * apps/api-worker/openapi/openapi.json; the transport envelope lives in $lib/api/request.ts.
 *
 * ONE READ, FOURTEEN SUBSYSTEMS. The server federates every declared timeline source under one sort
 * key and one cursor, so this client asks for a page and never for a source: adding a subsystem to
 * the platform's activity does not add a request here.
 *
 * AN ENTRY CARRIES NO PRIVILEGED TEXT, BY CONSTRUCTION. Most sources declare no label at all — a
 * note's words and an email's subject line are exactly what a read spanning a whole matter must not
 * broadcast — so an entry states which source, which row, when, and by whom, plus the deep link that
 * reaches the detail through the owning subsystem's own access gate. A client that wants the words
 * follows the link; there is no parameter that asks for them here.
 */
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";

export interface ActivityEntry {
  /** Which declared source produced it, e.g. "matterNote". A wire contract, permanent once shipped. */
  sourceKey: string;
  /** The narrower kind within that source, e.g. "matter.closed". Same source, different sentence. */
  kind: string;
  /** What the entry is ordered by: a civil date on most sources, an instant on a few. */
  sortKey: string;
  /** The owning row's identity, which the deep link names. */
  rowId: string;
  matterId: string | null;
  /** Who did it, where a person did. Null where the platform acted, or where nothing recorded one. */
  actorUserId: string | null;
  /** The source's declared non-privileged summary. Null where the source declares it has none. */
  label: string | null;
  /** Where the row itself is read, in the subsystem that owns it and behind its own access gate. */
  link: string;
}

/** What may narrow the read. Everything is optional; the default is the whole record, newest first. */
export interface ActivityQuery {
  /**
   * Which sources to read at all. Narrows the server's REGISTRY before any statement is built, so a
   * filtered read is cheaper rather than merely shorter — one statement per named source, not one
   * per source in the platform.
   */
  readonly sourceKeys?: readonly string[];
  /** Civil-date bounds, inclusive. */
  readonly from?: string;
  readonly to?: string;
  /**
   * Which half of the case. `all` is the default and is usually right: "what has happened" and
   * "what is coming" are one list read in one order, and a deadline next Tuesday belongs beside the
   * hearing it was calendared from.
   */
  readonly direction?: "all" | "past" | "future";
}

export function listMatterActivity(
  fetchImpl: typeof fetch,
  matterId: string,
  cursor?: string,
  query: ActivityQuery = {},
): Promise<ApiOutcome<Page<ActivityEntry>>> {
  const parameters = new URLSearchParams();
  if (cursor !== undefined) parameters.set("cursor", cursor);
  // Repeatable on the wire: the server takes `kind` more than once rather than a joined string.
  for (const sourceKey of query.sourceKeys ?? []) parameters.append("kind", sourceKey);
  if (query.from !== undefined) parameters.set("from", query.from);
  if (query.to !== undefined) parameters.set("to", query.to);
  if (query.direction !== undefined && query.direction !== "all") {
    parameters.set("direction", query.direction);
  }
  const suffix = parameters.size === 0 ? "" : `?${parameters.toString()}`;
  return requestJson(
    fetchImpl,
    `/api/v1/matters/${encodeURIComponent(matterId)}/timeline${suffix}`,
  );
}
