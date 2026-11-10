/*
 * The directory's name search, offered to the Search page as one of its places.
 *
 * It lives here, among the directory's own modules, because it is the directory answering a
 * question about its own record: who is called this. It is not a picker. Anything that asks a
 * member to CHOOSE a person or an organization goes through EntityPicker over
 * `./directory-picker-source.ts`, and test/entity-picker-gate.test.ts refuses a caller of the
 * search outside this directory so that a new picker cannot be hand-built over it. A list of
 * results that links to each record chooses nothing, and reads the same ranked, capped answer the
 * directory's own screen shows.
 */
import type { ApiOutcome } from "$lib/api/request.ts";
import { searchDirectory, type DirectorySearchResult } from "./directory-api.ts";

/** Every record whose current or former name matches, best match first, capped by the server. */
export function readDirectoryNameMatches(
  fetchImpl: typeof fetch,
  query: string,
): Promise<ApiOutcome<DirectorySearchResult>> {
  return searchDirectory(fetchImpl, query);
}
