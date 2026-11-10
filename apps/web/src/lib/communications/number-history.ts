/*
 * Earlier calls and texts with one number, as the History tab and the Identification panel both read
 * them.
 *
 * Read through the log's own search, which already matches the stored number, and then narrowed to
 * rows whose number IS this one: the search also matches what was said, and a message that happens
 * to quote the digits is not a call from them.
 */
import type { ApiOutcome } from "$lib/api/request.ts";
import { listCommunications, type Communication } from "./communications-api.ts";

export async function readNumberHistory(
  fetchImpl: typeof fetch,
  storedNumber: string,
): Promise<ApiOutcome<readonly Communication[]>> {
  // The digits alone: the stored form leads with a plus the log's search would read literally.
  const outcome = await listCommunications(fetchImpl, { search: storedNumber.replace(/^\+/u, "") });
  if (outcome.kind !== "ok") return outcome;
  // A stored number may carry its extension after the digits; the line is the same line.
  return {
    kind: "ok",
    value: outcome.value.data.filter((row) => row.counterpartyNumber.startsWith(storedNumber)),
  };
}

/**
 * How many times the firm has called this number spam (owner, 2026-11-09: marking spam "may be
 * helpful in the future for a SPAM likely"). Counted from the rows themselves rather than kept as a
 * tally beside them, so a call later re-filed onto a matter stops counting the moment it is.
 */
export function spamMarks(rows: readonly Communication[]): number {
  return rows.filter((row) => row.outcome === "spam" || row.disposition === "spam").length;
}
