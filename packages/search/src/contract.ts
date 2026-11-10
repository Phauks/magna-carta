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
    records: z.object({ places: z.array(SearchStatusRecordPlace) }),
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
