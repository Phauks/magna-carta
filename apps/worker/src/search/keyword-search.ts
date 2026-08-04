import { listLiveSplitsForMatter } from "@magna-carta/data-access/index-split-statements";
import type { FirmId, MatterId } from "@magna-carta/identifiers/types";
import type { SearchIndexPort, SearchQueryResult } from "@magna-carta/search/port";
import type { Bindings } from "../app.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
import { resolveSearchIndexPort } from "./search-engine.ts";

export interface KeywordSearchInput {
  readonly firmId: FirmId;
  readonly matterId: MatterId;
  readonly text: string;
  readonly limit: number;
}

// Run a keyword search over a matter's live corpus. This is where firm scoping and catalog enumeration
// live — in the app Worker, behind the data-access layer — while the engine stays a stateless
// range-reader: resolve the matter's live splits from the per-firm catalog, hand their object keys to
// the SearchIndexPort, and return the ranked hits. The engine never reaches the per-firm database, so a
// query can only ever see splits its own firm's catalog named. The port defaults to the real resolver;
// tests inject a fake to exercise the composition without the engine Container.
export async function runKeywordSearch(
  env: Bindings,
  input: KeywordSearchInput,
  port: SearchIndexPort = resolveSearchIndexPort(env),
): Promise<SearchQueryResult> {
  const database = firmDatabaseFor(env.FIRM_DATABASE, input.firmId);
  const liveSplits = await listLiveSplitsForMatter(database, input.matterId);
  const splitKeys = liveSplits.map((split) => split.objectKey);
  return port.query({
    firmId: input.firmId,
    matterId: input.matterId,
    text: input.text,
    mode: "keyword",
    limit: input.limit,
    splitKeys,
  });
}
