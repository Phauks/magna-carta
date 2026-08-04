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
// message. Turning it on later indexes documents committed from that point; re-indexing the existing
// corpus is a separate replay over the same queue, which the derived split ids make safe to run twice.
export const searchIndexingEnabledDefinition: FirmSettingDefinition<boolean> = {
  key: "search.indexing_enabled",
  schema: z.boolean(),
  defaultValue: false,
};

export function readSearchIndexingEnabled(database: SqlDatabase): Promise<boolean> {
  return readFirmSetting(database, searchIndexingEnabledDefinition);
}
