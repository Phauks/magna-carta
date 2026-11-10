import type { MatterId } from "@magna-carta/identifiers/types";
import type { MatterSearchRawRow } from "./types.ts";

// THE WORDS INSIDE A MATTER'S FILES, as a place the matter's search looks.
//
// A document's text is not in the firm's database. It is extracted into the file contents index, one
// index per matter, which the search service reads. This module is the part of that which needs no
// service: what the search asks, what an answer looks like, and how an answer becomes rows a reader
// sees. The application supplies the searcher, because only the application holds the service
// binding and the firm's catalog of what has been indexed.
//
// THE INDEX NAMES CANDIDATES AND NOTHING MORE. It answers with file identifiers and the page each
// match was on. The files source then reads those files from the firm's own `file` table, in a
// statement that binds the matter and composes the visibility predicate like every other source's,
// so a file the index names that is not on this matter, or is not there any more, is not a result.
// The index is a copy; the database is what says where a file is filed.

// One passage the index matched: the file it is in and which passage of that file. Passages arrive
// best match first.
export interface FileContentsPassage {
  readonly fileId: string;
  // `page-<n>`, counted from zero, for a document read page by page. Anything else is a passage
  // with no page a reader could turn to.
  readonly chunkId: string;
}

export type FileContentsAnswer =
  | { readonly kind: "passages"; readonly passages: readonly FileContentsPassage[] }
  // The firm has not turned file indexing on, so there is nothing to ask.
  | { readonly kind: "off" }
  // The index's service is not connected, or did not answer.
  | { readonly kind: "unavailable" };

export interface MatterFileContentsSearcher {
  query(input: {
    readonly matterId: MatterId;
    // Already built for the engine by `keywordQueryText`; never a reader's raw text.
    readonly queryText: string;
    // How many passages to return at most.
    readonly limit: number;
  }): Promise<FileContentsAnswer>;
}

// One file can match on many pages, and a search wants files. Asking for several passages per file
// wanted is what lets that many distinct files come back when one long document matches on every
// page; the ceiling keeps one question bounded whatever the limit.
const PASSAGES_PER_FILE = 8;
const MOST_PASSAGES_ASKED_FOR = 400;

export function passagesToAskFor(fileLimit: number): number {
  return Math.min(fileLimit * PASSAGES_PER_FILE, MOST_PASSAGES_ASKED_FOR);
}

// A file the index matched, with the pages it matched on in the order the index ranked them.
export interface FileContentsCandidate {
  readonly fileId: string;
  readonly pages: readonly number[];
}

const PAGE_CHUNK = /^page-(\d+)$/u;

// The distinct files among the passages, best first, stopping at `fileLimit`. A file's place is its
// best passage's place.
export function candidatesFrom(
  passages: readonly FileContentsPassage[],
  fileLimit: number,
): FileContentsCandidate[] {
  const pagesByFile = new Map<string, number[]>();
  for (const passage of passages) {
    let pages = pagesByFile.get(passage.fileId);
    if (pages === undefined) {
      if (pagesByFile.size >= fileLimit) continue;
      pages = [];
      pagesByFile.set(passage.fileId, pages);
    }
    const match = PAGE_CHUNK.exec(passage.chunkId);
    if (match === null) continue;
    // The index counts pages from zero; a reader counts from one.
    const page = Number(match[1]) + 1;
    if (!pages.includes(page)) pages.push(page);
  }
  return [...pagesByFile].map(([fileId, pages]) => ({ fileId, pages }));
}

// How many pages a result names before it says how many more there are.
const PAGES_NAMED = 3;

// Where in the file the words were found, in a reader's terms, or null when the index recorded no
// page. The pages named are the best matches, put in reading order.
export function pageNote(pages: readonly number[]): string | null {
  if (pages.length === 0) return null;
  const named = pages.slice(0, PAGES_NAMED).toSorted((left, right) => left - right);
  const [first] = named;
  if (named.length === 1 && first !== undefined) return `Page ${first}`;
  const more = pages.length - named.length;
  const list =
    more > 0
      ? `${named.join(", ")} and ${more} more`
      : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
  return `Pages ${list}`;
}

// Puts the rows the files statement returned into the index's order, and says on each one where in
// the file the words were. A row the statement did not return is a candidate the database refused,
// and it is simply not here.
export function arrangeByCandidates(
  rows: readonly MatterSearchRawRow[],
  candidates: readonly FileContentsCandidate[],
): MatterSearchRawRow[] {
  const byId = new Map(rows.map((row) => [row.row_id, row]));
  const arranged: MatterSearchRawRow[] = [];
  for (const candidate of candidates) {
    const row = byId.get(candidate.fileId);
    if (row === undefined) continue;
    const note = pageNote(candidate.pages);
    const secondary = [note, row.secondary].filter((part): part is string => part !== null);
    arranged.push({ ...row, secondary: secondary.length === 0 ? null : secondary.join(" · ") });
  }
  return arranged;
}
