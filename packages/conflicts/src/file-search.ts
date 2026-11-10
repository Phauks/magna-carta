import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  chunks,
  type ContentHit,
  type FileMatterStatus,
  type FoundIn,
  MATTER_STATUSES_BY_OPTION,
  MAX_BOUND_PARAMETERS,
  type PartyNeedles,
  placeholders,
} from "./content-search.ts";

// THE FIRM'S FILES AS A PLACE A CHECK LOOKS: the text of every document filed on a matter.
//
// Document text is not in the firm's database. It is extracted into the file contents index, one
// index per matter, which the search service reads; this module never sees a document's text and
// never stores any. It asks the index which of a matter's files name a party, and records the file,
// its matter and when it last changed.
//
// WHY ONE MATTER AT A TIME. The file contents index is partitioned by matter, and a query never spans
// two: that partition is what keeps a discovery review set (opposing parties' productions, which may
// be under a protective order) out of reach of every search but discovery's own. A check therefore
// asks each matter in turn, never a review set. The asking is bounded, because the run has a fixed
// budget and a firm can hold thousands of matters: the most recently active matters are asked first,
// and any the run had no room for are counted and reported as not searched rather than passed over
// silently.
//
// HOW A PARTY IS LOOKED FOR. Each of the party's names is an exact phrase: every word, in order,
// without regard to case. "Acme Holdings" never matches a document that says "Acme" on one page and
// "Holdings" on another. A party is found by name only, so every result is tier 2; a document cannot
// carry the Directory link that would make it tier 1.
//
// DORMANT UNTIL THE SEARCH SERVICE IS CONNECTED. The searcher reports `unavailable` while the index's
// service is not bound, and the check records Files as not searched, with that reason, instead of as
// searched and empty.

// What the run hands this module: the one way it reaches the file contents index. The application
// supplies it, because only the application holds the service binding and the firm's catalog of
// index splits. A run without one records Files as not searched.
export interface FileContentsSearcher {
  // The files in one matter's index whose text contains any of the phrases. `unavailable` is the
  // index not being reachable at all; `failed` is this one matter's query failing.
  query(input: {
    readonly matterId: string;
    readonly phrases: readonly string[];
    readonly limit: number;
  }): Promise<FileContentsAnswer>;
  // Which of these matters could hold a document naming any of these words, from a firm-wide summary
  // of what each matter's index contains. "unknown" means no summary exists, so every matter must be
  // asked. Optional: without it every matter in reach is asked.
  narrowMatters?(
    nameTokens: readonly string[],
    matterIds: readonly string[],
  ): Promise<readonly string[] | "unknown">;
}

export type FileContentsAnswer =
  | { readonly ok: true; readonly fileIds: readonly string[] }
  | { readonly ok: false; readonly reason: "unavailable" | "failed" };

// The most questions one check asks the index: one per party per matter. Each is a range read of a
// matter's index by the search service, a few tens of milliseconds, run a few at a time; this keeps
// the whole of Files well inside the budget of a run a person is watching.
export const FILE_QUERY_CEILING = 400;
const CONCURRENT_QUERIES = 8;
// The most files one question returns. A party named in more files than this in one matter is a
// party the firm plainly knows; the first files are what a reader needs to see it.
const FILES_PER_QUERY = 25;

export interface FileSearchOutcome {
  // `unavailable`: the index could not be reached, so nothing was searched.
  readonly status: "searched" | "unavailable";
  readonly hits: readonly ContentHit[];
  // Matters whose files were in reach for the options asked.
  readonly mattersInReach: number;
  readonly mattersSearched: number;
  // In reach but not asked, because the run reached FILE_QUERY_CEILING.
  readonly mattersNotSearched: number;
  // Asked, and the index failed to answer for them.
  readonly mattersFailed: number;
}

const NOTHING_SEARCHED = (status: FileSearchOutcome["status"]): FileSearchOutcome => ({
  status,
  hits: [],
  mattersInReach: 0,
  mattersSearched: 0,
  mattersNotSearched: 0,
  mattersFailed: 0,
});

// A name as one exact phrase the index's query language reads. A double quote or backslash would end
// or escape the phrase, so they are dropped; nothing else in a phrase has a meaning of its own.
export function phraseOf(name: string): string | null {
  const words = name.replaceAll(/["\\]/gu, " ").trim().replaceAll(/\s+/gu, " ");
  return words === "" ? null : `"${words}"`;
}

// The lowercased words of every name, for narrowing the matters by a summary of their indexes.
function nameTokens(parties: readonly PartyNeedles[]): string[] {
  const tokens = new Set<string>();
  for (const party of parties) {
    for (const name of party.names) {
      for (const word of name.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
        if (word !== "") tokens.add(word);
      }
    }
  }
  return [...tokens];
}

interface MatterRow {
  id: string;
  status: string;
}

// Every matter whose files the options put in reach, most recently active first. Archived asks for
// the deleted files of every matter, so it puts every matter in reach.
async function mattersInReach(
  database: SqlDatabase,
  statuses: readonly FileMatterStatus[],
): Promise<MatterRow[]> {
  const live = statuses.flatMap((status) =>
    status === "archived" ? [] : MATTER_STATUSES_BY_OPTION[status],
  );
  const everyMatter = statuses.includes("archived");
  if (!everyMatter && live.length === 0) return [];
  const where = everyMatter ? "" : `WHERE status IN (${placeholders(live.length)})`;
  const { results } = await database
    .prepare(`SELECT id, status FROM matter ${where} ORDER BY updated_at DESC, id`)
    .bind(...(everyMatter ? [] : live))
    .all<MatterRow>();
  return results;
}

async function inBatches<T, R>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (const batch of chunks(items, size)) out.push(...(await Promise.all(batch.map(work))));
  return out;
}

export async function searchFiles(
  database: SqlDatabase,
  parties: readonly PartyNeedles[],
  statuses: readonly FileMatterStatus[],
  searcher: FileContentsSearcher | null,
): Promise<FileSearchOutcome> {
  if (statuses.length === 0) return NOTHING_SEARCHED("searched");
  if (searcher === null) return NOTHING_SEARCHED("unavailable");

  const askable = parties
    .map((party) => ({
      entityId: party.entityId,
      names: party.names,
      phrases: party.names.map(phraseOf).filter((phrase): phrase is string => phrase !== null),
    }))
    .filter((party) => party.phrases.length > 0);

  const reach = await mattersInReach(database, statuses);
  const liveStatuses = new Set(
    statuses.flatMap((status) => (status === "archived" ? [] : MATTER_STATUSES_BY_OPTION[status])),
  );
  const statusOf = new Map(reach.map((row) => [row.id, row.status]));

  let candidates = reach.map((row) => row.id);
  if (searcher.narrowMatters !== undefined && candidates.length > 0 && askable.length > 0) {
    const narrowed = await searcher.narrowMatters(nameTokens(parties), candidates);
    if (narrowed !== "unknown") {
      const keep = new Set(narrowed);
      candidates = candidates.filter((id) => keep.has(id));
    }
  }

  const perMatter = Math.max(1, askable.length);
  const matterBudget = Math.floor(FILE_QUERY_CEILING / perMatter);
  const asked = askable.length === 0 ? [] : candidates.slice(0, matterBudget);
  const mattersNotSearched = askable.length === 0 ? 0 : candidates.length - asked.length;

  // One question per party per matter, so each file found is attributed to the party it names.
  const questions = asked.flatMap((matterId) => askable.map((party) => ({ matterId, party })));
  let unavailable = false;
  const failedMatters = new Set<string>();
  const found: { matterId: string; entityId: string; names: readonly string[]; fileId: string }[] =
    [];

  // The first answer says whether the index is reachable at all; asking the rest of the firm a
  // question the first one could not answer would only repeat that.
  const [first, ...rest] = questions;
  const ask = async (question: (typeof questions)[number]): Promise<void> => {
    if (unavailable) return;
    const answer = await searcher.query({
      matterId: question.matterId,
      phrases: question.party.phrases,
      limit: FILES_PER_QUERY,
    });
    if (!answer.ok) {
      if (answer.reason === "unavailable") unavailable = true;
      else failedMatters.add(question.matterId);
      return;
    }
    for (const fileId of answer.fileIds) {
      found.push({
        matterId: question.matterId,
        entityId: question.party.entityId,
        names: question.party.names,
        fileId,
      });
    }
  };
  if (first !== undefined) await ask(first);
  if (!unavailable) await inBatches(rest, CONCURRENT_QUERIES, ask);
  if (unavailable) {
    return { ...NOTHING_SEARCHED("unavailable"), mattersInReach: reach.length };
  }

  // The files themselves, to keep only those the options asked for and to date each result. A file
  // the index names that is not on the matter it was found under is not reported: the index is a copy,
  // and the database is what says where a file is filed.
  const fileIds = [...new Set(found.map((entry) => entry.fileId))];
  const files = new Map<string, { matterId: string; deleted: boolean; at: string }>();
  for (const chunk of chunks(fileIds, MAX_BOUND_PARAMETERS)) {
    const { results } = await database
      .prepare(
        `SELECT id, matter_id, deleted_at, updated_at FROM file WHERE id IN (${placeholders(chunk.length)})`,
      )
      .bind(...chunk)
      .all<{ id: string; matter_id: string; deleted_at: string | null; updated_at: string }>();
    for (const row of results) {
      files.set(row.id, {
        matterId: row.matter_id,
        deleted: row.deleted_at !== null,
        at: row.updated_at,
      });
    }
  }

  const archivedAsked = statuses.includes("archived");
  const seen = new Set<string>();
  const hits: ContentHit[] = [];
  for (const entry of found) {
    const file = files.get(entry.fileId);
    if (file?.matterId !== entry.matterId) continue;
    const inReach = file.deleted
      ? archivedAsked
      : liveStatuses.has(statusOf.get(entry.matterId) ?? "");
    if (!inReach) continue;
    const key = `${entry.entityId}\u0000${entry.fileId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const foundIn: FoundIn = {
      kind: "file",
      id: entry.fileId,
      matterId: entry.matterId,
      at: file.at,
    };
    const [onlyName] = entry.names;
    const field =
      entry.names.length === 1 && onlyName !== undefined
        ? `"${onlyName}" is named in the file's text`
        : "one of the party's names is in the file's text";
    hits.push({
      entityId: entry.entityId,
      tier: 2,
      matchedFields: [file.deleted ? `${field} (a deleted file)` : field],
      foundIn,
    });
  }
  const ordered = hits.toSorted(
    (left, right) =>
      (right.foundIn.at ?? "").localeCompare(left.foundIn.at ?? "") ||
      left.foundIn.id.localeCompare(right.foundIn.id) ||
      left.entityId.localeCompare(right.entityId),
  );

  return {
    status: "searched",
    hits: ordered,
    mattersInReach: reach.length,
    mattersSearched: asked.length - failedMatters.size,
    mattersNotSearched,
    mattersFailed: failedMatters.size,
  };
}
