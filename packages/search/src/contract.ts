import { z } from "zod";
import type { RecordIndexReader } from "./record-index-sources.ts";

// What the firm's search status read answers, as plain zod. Each component is named with zod's own
// metadata (`.meta({ id })`), which the contract emitter reads as the component's name, so the route
// module in apps/api-worker declares its route over these without restating a field. The rule is in
// docs/conventions/api.md (_Where a contract shape lives_).
//
// EVERY NUMBER IS A COUNT, made when the read is asked for. Nothing here is a stored figure, and
// nothing here is a figure about a discovery review set: each set's index is its own corpus behind
// that set's access list, and a firm-wide total would be a read across it.

const READERS = [
  "matter-search",
  "conflicts-check",
] as const satisfies readonly RecordIndexReader[];

export const SearchStatusRecordPlace = z
  .object({
    // The place's stable key, as the record index stores it.
    key: z.string(),
    // What a person calls the place.
    label: z.string(),
    // What is matched there, in a reader's words.
    matchedFields: z.array(z.string()),
    // Which searches read this place through the index today. Empty for a place that is indexed
    // and not read by anything yet.
    readBy: z.array(z.enum(READERS)),
    // How many of the place's records the index holds.
    indexed: z.number().int().nonnegative(),
    // How many of the place's records belong in the index, counted from the records themselves.
    // Equal to `indexed` unless the index has fallen behind them.
    expected: z.number().int().nonnegative(),
  })
  .meta({ id: "SearchStatusRecordPlace" });

export const FirmSearchStatusResponse = z
  .object({
    // When these numbers were counted.
    checkedAt: z.string(),
    records: z.object({
      places: z.array(SearchStatusRecordPlace),
      // The rebuild of the places that are behind, as the firm's audit log records it. These are
      // moments and not figures: when a member last asked for one, and when one last ran to its
      // end. A request with no finish at or after it is a rebuild still to run.
      rebuild: z.object({
        requestedAt: z.string().nullable(),
        finishedAt: z.string().nullable(),
        outstanding: z.boolean(),
      }),
    }),
    fileContents: z.object({
      // The firm's switch: whether the contents of its files are indexed at all.
      turnedOn: z.boolean(),
      // Whether this deployment has a search service to index with.
      serviceConnected: z.boolean(),
      // How many files belong in the index: the current, clean version of every file that is not
      // deleted.
      filesBelonging: z.number().int().nonnegative(),
      // How many of those the index holds. The difference is files that are NOT indexed, which
      // includes files whose words nothing can read; it is not a queue.
      filesIndexed: z.number().int().nonnegative(),
      // When the index last took a file in, or null where it holds none.
      lastIndexedAt: z.string().nullable(),
      // The most files the daily repair pass starts for one firm, so a firm can see why a large
      // back catalogue is drawn in over days.
      dailyCatchUpLimit: z.number().int().positive(),
    }),
    searchByMeaning: z.object({
      // The firm's own decision to allow it.
      turnedOn: z.boolean(),
      // Whether this deployment has the service it runs on.
      serviceConnected: z.boolean(),
    }),
  })
  .meta({ id: "FirmSearchStatusResponse" });

export type FirmSearchStatusBody = z.infer<typeof FirmSearchStatusResponse>;

// What asking for a rebuild answers: that it was asked for, and when. The rebuild itself runs
// afterwards from a queue, so there is no count here and nothing about what it will find.
export const FirmSearchRebuildResponse = z
  .object({
    // When the request was recorded.
    requestedAt: z.string(),
  })
  .meta({ id: "FirmSearchRebuildResponse" });

export type FirmSearchRebuildBody = z.infer<typeof FirmSearchRebuildResponse>;

// ---- the search across matters ----
//
// One question answered from every matter the reader may see, one group to a place. The shapes are
// the matter search's own with two additions: every hit names the matter it is on, because a hit
// here is not on a matter the reader is already standing in, and the answer says when it was drawn
// from the most recent records instead of from all of them.

// Where one run of a reader's words is in a text a result shows: offsets in UTF-16 code units, the
// end not included, so a JavaScript `text.slice(start, end)` is the run. Marks arrive sorted and
// never overlap. Shared by a matter's own search and the search across matters.
export const SearchTextMark = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  })
  .meta({ id: "SearchTextMark" });

export const SearchAcrossMattersHit = z
  .object({
    id: z.string(),
    title: z.string(),
    // Where the reader's words are in `title`. Empty where the title is not what matched.
    titleMarks: z.array(SearchTextMark),
    // The declared excerpt, or null where the place declares it has none. A long text is quoted at
    // the stretch the reader's words are in.
    snippet: z.string().nullable(),
    // Where the reader's words are in `snippet`.
    snippetMarks: z.array(SearchTextMark),
    secondary: z.string().nullable(),
    actorUserId: z.string().nullable(),
    sortKey: z.string(),
    // The record's own section on its own matter, behind that section's own gate.
    link: z.string(),
    // The matter the record is on, as a reader recognizes it. The number is the one the matter
    // wears today: its matter number, or the consultation or intake number where it has not been
    // opened yet, or null where it has none at all.
    matter: z.object({
      id: z.string(),
      title: z.string(),
      number: z.string().nullable(),
    }),
  })
  .meta({ id: "SearchAcrossMattersHit" });

export const SearchAcrossMattersGroup = z
  .object({
    source: z.string(),
    section: z.string(),
    answerShape: z.enum(["listing", "ranked"]),
    // What this place matched on ACROSS MATTERS, which for some places is less than inside one.
    matchedFields: z.array(z.string()),
    hits: z.array(SearchAcrossMattersHit),
    // Measured by reading one row past the limit, never estimated.
    hasMore: z.boolean(),
    // Why this place contributed nothing, or null when it answered. `one-matter-only` is a place
    // that is searched inside a matter and not across them; the rest mean what they mean in a
    // matter's own search.
    skipped: z
      .enum([
        "one-matter-only",
        "permission",
        "query-too-short",
        "engine-unavailable",
        "engine-not-connected",
        "not-indexed",
      ])
      .nullable(),
  })
  .meta({ id: "SearchAcrossMattersGroup" });

export const SearchAcrossMattersAnswer = z
  .object({
    query: z.string(),
    // True when the words are in more of the firm's records than one search reads. The groups then
    // hold the most recent records with those words, and a group with no hits has not shown that
    // its place holds none.
    broad: z.boolean(),
    // One group per place, in the order a matter's own sections read in.
    groups: z.array(SearchAcrossMattersGroup),
  })
  .meta({ id: "SearchAcrossMattersAnswer" });

export type SearchAcrossMattersAnswerBody = z.infer<typeof SearchAcrossMattersAnswer>;
