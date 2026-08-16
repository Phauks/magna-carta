import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { z } from "zod";

// Whether a firm's working documents are fed into the managed natural-language search index, and
// whether that index may be queried at all. OFF by default, on the same shape as
// `search.indexing_enabled` beside it and `inference.aiProcessingEligibility`: a missing row IS the
// default in code, and the default is the strictest posture.
//
// WHY THIS IS ITS OWN GATE, rather than riding the keyword index's. The keyword index is built from
// the firm's own extracted text, into the firm's own bucket, read by an engine the platform runs.
// This one copies that text into a managed store and a managed vector index the platform cannot
// name, inspect, enumerate, or partition. No third-party model provider is involved — embedding and
// reranking are Cloudflare's own on-network models — but "no third party" is not the same statement
// as "nothing moved", and where a firm's privileged bytes come to rest is the firm's decision about
// its own client agreements rather than the platform's.
//
// WHY IT IS NOT `inference.aiProcessingEligibility`. That gate asks one specific question — may this
// firm's content go to a third-party frontier model at all? This feature sends nothing to one.
// Requiring it would conflate two different questions and would deny an on-network feature to
// precisely the most conservative firms, who are the ones the on-network path exists for.
//
// The gate is read at ENQUEUE time on the feed path, so a firm that has not opted in never produces
// a feed object as a side effect of the platform being ready, and read AGAIN before any query, so a
// gate closed since a session started refuses rather than answering out of an index that is being
// deleted.
export const naturalLanguageSearchEnabledDefinition: FirmSettingDefinition<boolean> = {
  key: "search.naturalLanguageEnabled",
  schema: z.boolean(),
  defaultValue: false,
};

// The total read: an absent row, an unparseable value, or an invalid one all resolve to `false`. A
// gate that cannot be read is a gate that is shut.
export function readNaturalLanguageSearchEnabled(database: SqlDatabase): Promise<boolean> {
  return readFirmSetting(database, naturalLanguageSearchEnabledDefinition);
}
