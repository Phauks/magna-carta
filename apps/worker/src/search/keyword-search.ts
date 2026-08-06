import { listLiveSplitsForMatter } from "@magna-carta/data-access/index-split-statements";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { CorpusScope } from "@magna-carta/search/corpus";
import type { SearchIndexPort, SearchQueryResult } from "@magna-carta/search/port";
import type { Bindings } from "../app.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
import { resolveSearchIndexPort } from "./search-engine.ts";

export interface KeywordSearchInput {
  readonly firmId: FirmId;
  readonly corpus: CorpusScope;
  readonly text: string;
  readonly limit: number;
}

// Run a keyword search over a corpus's live splits. This is where firm scoping and catalog enumeration
// live — in the app Worker, behind the data-access layer — while the engine stays a stateless
// range-reader: resolve the corpus's live splits from the per-firm catalog, hand their object keys to
// the SearchIndexPort, and return the ranked hits. The engine never reaches the per-firm database, so a
// query can only ever see splits its own firm's catalog named. The port defaults to the real resolver;
// tests inject a fake to exercise the composition without the engine Container.
export async function runKeywordSearch(
  env: Bindings,
  input: KeywordSearchInput,
  port: SearchIndexPort = resolveSearchIndexPort(env),
): Promise<SearchQueryResult> {
  const database = firmDatabaseFor(env.FIRM_DATABASE, input.firmId);
  // The catalog is still keyed by matter, and a corpus identifier is a matter identifier today, so the
  // enumeration is exact. When a second corpus kind arrives, this call stops type-checking — which is
  // the point: the compiler names the one place the catalog has to widen with it, rather than letting a
  // review-set query silently enumerate a matter's splits.
  const liveSplits = await listLiveSplitsForMatter(database, input.corpus.id);
  const splitKeys = liveSplits.map((split) => split.objectKey);
  return port.query({
    firmId: input.firmId,
    corpus: input.corpus,
    text: input.text,
    mode: "keyword",
    limit: input.limit,
    splitKeys,
  });
}
