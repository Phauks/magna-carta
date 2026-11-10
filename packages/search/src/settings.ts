import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { z } from "zod";

// Whether a firm's committed documents are fed into the discovery search index. OFF by default, and
// deliberately a firm setting rather than a deploy-time binding check: the engine's availability is
// already expressed by whether the search service binding resolves (search-engine.ts), and that is a
// platform fact. This is the separate, per-firm question of whether a firm wants its corpus indexed at
// all — a firm that has not opted in should not have its documents queued, extracted, and written into
// R2 as a side effect of the platform being ready.
//
// The gate is read at ENQUEUE time, on the ingest path, so a firm with indexing off never produces a
// message. Turning it on later indexes documents committed from that point, and the daily
// re-extraction sweep (apps/api-worker/src/background/search/reextraction-sweep.ts) then draws in the corpus that was
// already there — it re-enqueues through this same gate, so a firm that never opted in stays untouched.
//
// ONE WRITER: the firm's search settings route (apps/api-worker/src/http/routes/firm/search-settings.ts),
// behind firm:manageSearchSettings. Turning it on there also starts the first of the firm's existing
// files without waiting for the daily pass.
export const searchIndexingEnabledDefinition: FirmSettingDefinition<boolean> = {
  key: "search.indexing_enabled",
  schema: z.boolean(),
  defaultValue: false,
};

export function readSearchIndexingEnabled(database: SqlDatabase): Promise<boolean> {
  return readFirmSetting(database, searchIndexingEnabledDefinition);
}

// ── Compaction ──────────────────────────────────────────────────────────────
//
// The write pipeline publishes one split per document version, so a corpus's live split count tracks the
// number of documents ever indexed into it. A query is handed every live split, and reads each one's
// footer, metadata, term dictionary, and postings separately, so per-query reads track that count too.
// Compaction merges many splits into one and turns "however many documents there are" into "however many
// splits the threshold allows".
//
// EVERY THRESHOLD BELOW IS A FIRM SETTING, NOT A CONSTANT, and that is deliberate. Compaction trades a
// query's R2 Class B reads (which it reduces) against the merge's own reads and its write (which it
// adds). Which way that trade falls depends on how often a corpus is searched versus written, and neither
// the design nor a local benchmark can price it — only a deployment can. Shipping the recommended values
// as defaults means the answer can be changed for a firm that searches constantly, or one that ingests
// constantly, without a deploy.

// How many live splits a corpus may hold before a compaction is enqueued.
//
// The default is a read-cost budget rather than a round number. Per-query reads grow roughly linearly
// with the split count, so a corpus at N splits costs about N times a compacted one; 32 keeps an
// uncompacted corpus's worst case within a few hundred range GETs, which is recoverable, while being high
// enough that an ordinary matter is not merging after every handful of documents.
export const searchCompactionSplitThresholdDefinition: FirmSettingDefinition<number> = {
  key: "search.compaction_split_threshold",
  schema: z.number().int().min(2).max(10_000),
  defaultValue: 32,
};

// How many superseded document versions a corpus's live splits may carry before a compaction is enqueued
// on that ground alone.
//
// A corpus can need compacting without gaining a single split: re-indexing a document leaves its old
// passages inside whatever merged split holds them, costing bytes to store and one exclusion clause on
// every query against that split until a merge repacks them out. Without this threshold a heavily-revised
// matter that never grows would accumulate exclusions indefinitely.
export const searchCompactionStaleThresholdDefinition: FirmSettingDefinition<number> = {
  key: "search.compaction_stale_threshold",
  schema: z.number().int().min(1).max(100_000),
  defaultValue: 64,
};

// The most splits one pass will merge. A bound on the bookkeeping — readers, catalog rows, membership —
// that one pass has to hold at once.
export const searchCompactionMaximumInputSplitsDefinition: FirmSettingDefinition<number> = {
  key: "search.compaction_maximum_input_splits",
  schema: z.number().int().min(2).max(2_000),
  defaultValue: 200,
};

// The most bytes one pass will read into a merge. A bound on the merge itself, which the split count
// cannot supply: splits are not the same size, and a thousand-page production and a one-line memo are
// both one split. A corpus over either bound converges over several passes rather than attempting one
// merge that would exceed a Container's memory and its wall clock.
export const searchCompactionMaximumInputBytesDefinition: FirmSettingDefinition<number> = {
  key: "search.compaction_maximum_input_bytes",
  schema: z
    .number()
    .int()
    .min(1_000_000)
    .max(2 * 1024 * 1024 * 1024),
  defaultValue: 256 * 1024 * 1024,
};

export interface SearchCompactionPolicy {
  readonly splitThreshold: number;
  readonly staleThreshold: number;
  readonly maximumInputSplits: number;
  readonly maximumInputBytes: number;
}

// Read the whole policy at once. One call, so the trigger and the pass can never disagree about the
// thresholds by reading them at different moments or from different places.
export async function readSearchCompactionPolicy(
  database: SqlDatabase,
): Promise<SearchCompactionPolicy> {
  const [splitThreshold, staleThreshold, maximumInputSplits, maximumInputBytes] = await Promise.all(
    [
      readFirmSetting(database, searchCompactionSplitThresholdDefinition),
      readFirmSetting(database, searchCompactionStaleThresholdDefinition),
      readFirmSetting(database, searchCompactionMaximumInputSplitsDefinition),
      readFirmSetting(database, searchCompactionMaximumInputBytesDefinition),
    ],
  );
  return { splitThreshold, staleThreshold, maximumInputSplits, maximumInputBytes };
}
