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
  // The index's service is not part of this deployment yet.
  | { readonly kind: "not-connected" }
  // The index's service was asked and did not answer.
  | { readonly kind: "unavailable" };

export interface MatterFileContentsSearcher {
  query(input: {
    readonly matterId: MatterId;
    // Already built for the engine by `keywordQueryText`; never a reader's raw text.
    readonly queryText: string;
    // How many passages to return at most.
    readonly limit: number;
  }): Promise<FileContentsAnswer>;
  // The same question asked of several matters, each of its own index and of no other, and
  // answered as one list, best first. There is no index of every matter's files to ask instead, so
  // the cost is one question a matter, which is why a caller names the matters and names few. An
  // empty list asks no index and still says whether there is one to ask, so a caller that has no
  // matters to name can tell "nothing to ask" from "nowhere to ask it".
  //
  // The scores the lists are merged by come from separate indexes and are not on one scale. They
  // are close enough to put the strongest passages first, and no more is claimed of the order.
  //
  // Optional, because a searcher that answers for one matter is still a searcher.
  queryMatters?(input: {
    readonly matterIds: readonly MatterId[];
    readonly queryText: string;
    readonly limit: number;
  }): Promise<FileContentsAnswer>;
  // The sentence each of these files is quoted by: for each file, an excerpt of the passage named,
  // where the reader's words are. Asked only for files the search's own statement has already
  // returned, so nothing is quoted from a file the database refused. A file is simply absent from
  // the answer when it cannot be quoted (its text was not kept, it has changed since it was
  // indexed, the words are past what is read), and the result then names its pages alone. Never
  // throws: a quote is an addition to an answer, and failing one must not cost the answer.
  //
  // Optional, because the text is kept by the application and a searcher without it still answers.
  excerpts?(input: {
    readonly matterId: MatterId;
    // The reader's own text. The words are found again in the passage by the index's rules.
    readonly readerText: string;
    readonly files: readonly FileContentsPassage[];
  }): Promise<ReadonlyMap<string, string>>;
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
  // The file's best passage, as the index named it: the one a result quotes from.
  readonly bestChunkId: string;
}

const PAGE_CHUNK = /^page-(\d+)$/u;

// The distinct files among the passages, best first, stopping at `fileLimit`. A file's place is its
// best passage's place.
export function candidatesFrom(
  passages: readonly FileContentsPassage[],
  fileLimit: number,
): FileContentsCandidate[] {
  const byFile = new Map<string, { readonly pages: number[]; readonly bestChunkId: string }>();
  for (const passage of passages) {
    let file = byFile.get(passage.fileId);
    if (file === undefined) {
      if (byFile.size >= fileLimit) continue;
      // Passages arrive best first, so a file's first passage is its best.
      file = { pages: [], bestChunkId: passage.chunkId };
      byFile.set(passage.fileId, file);
    }
    const match = PAGE_CHUNK.exec(passage.chunkId);
    if (match === null) continue;
    // The index counts pages from zero; a reader counts from one.
    const page = Number(match[1]) + 1;
    if (!file.pages.includes(page)) file.pages.push(page);
  }
  return Array.from(byFile, ([fileId, file]) => ({
    fileId,
    pages: file.pages,
    bestChunkId: file.bestChunkId,
  }));
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

// Puts on each row the sentence its file is quoted by, for the rows that have one. The rows are the
// ones a reader is about to be shown, and only those: a quote is read from the firm's storage, one
// read or two a file, so it is not fetched for a row that is then cut off by the limit.
export async function quoteCandidates(
  rows: readonly MatterSearchRawRow[],
  candidates: readonly FileContentsCandidate[],
  request: {
    readonly matterId: MatterId;
    readonly readerText: string;
    readonly searcher: MatterFileContentsSearcher;
  },
): Promise<MatterSearchRawRow[]> {
  if (request.searcher.excerpts === undefined || rows.length === 0) return [...rows];
  const bestChunkByFile = new Map(
    candidates.map((candidate) => [candidate.fileId, candidate.bestChunkId]),
  );
  const files: FileContentsPassage[] = [];
  for (const row of rows) {
    const chunkId = bestChunkByFile.get(row.row_id);
    if (chunkId !== undefined) files.push({ fileId: row.row_id, chunkId });
  }
  if (files.length === 0) return [...rows];
  const excerpts = await request.searcher.excerpts({
    matterId: request.matterId,
    readerText: request.readerText,
    files,
  });
  return rows.map((row) => {
    const excerpt = excerpts.get(row.row_id);
    return excerpt === undefined ? row : { ...row, snippet: excerpt };
  });
}

// The same, for rows from several matters. Each matter's rows are quoted by that matter's own read,
// which checks each file against the matter it is filed on, so a file is quoted only where the
// database says it is. The matters are the ones on the rows: what the search's own statement
// returned, never what the index said.
export async function quoteCandidatesAcrossMatters(
  rows: readonly MatterSearchRawRow[],
  candidates: readonly FileContentsCandidate[],
  request: { readonly readerText: string; readonly searcher: MatterFileContentsSearcher },
): Promise<MatterSearchRawRow[]> {
  const byMatter = new Map<string, MatterSearchRawRow[]>();
  for (const row of rows) {
    const onMatter = byMatter.get(row.matter_id);
    if (onMatter === undefined) byMatter.set(row.matter_id, [row]);
    else onMatter.push(row);
  }
  const quoted = await Promise.all(
    Array.from(byMatter, ([matterId, onMatter]) =>
      quoteCandidates(onMatter, candidates, {
        matterId: matterId as MatterId,
        readerText: request.readerText,
        searcher: request.searcher,
      }),
    ),
  );
  const byId = new Map(quoted.flat().map((row) => [row.row_id, row]));
  // The order the rows came in, which is the index's.
  return rows.map((row) => byId.get(row.row_id) ?? row);
}
