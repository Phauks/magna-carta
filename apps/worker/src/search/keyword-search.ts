import {
  listLiveSplitsForMatter,
  listStaleMembersForMatter,
} from "@magna-carta/data-access/index-split-statements";
import type { FileId, FirmId, IndexSplitId } from "@magna-carta/identifiers/types";
import type { CorpusScope } from "@magna-carta/search/corpus";
import type {
  SearchIndexPort,
  SearchQueryResult,
  SplitQueryTarget,
} from "@magna-carta/search/port";
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
  const [liveSplits, staleMembers] = await Promise.all([
    listLiveSplitsForMatter(database, input.corpus.id),
    // The second catalog read, and it is what keeps a re-indexed document from matching its own stale
    // passages. A compacted split is immutable while the corpus is not: it still holds the passages of
    // every version it was merged from, so when one of those documents is re-indexed both the new
    // per-document split and the old text inside the merged split are live until the next compaction
    // repacks it. Naming the superseded ids per split is what makes the old text stop matching in the
    // meantime — and it has to be per split, because the same document is legitimately live at a newer
    // version in a different one.
    listStaleMembersForMatter(database, input.corpus.id),
  ]);

  const exclusions = new Map<IndexSplitId, FileId[]>();
  for (const member of staleMembers) {
    const existing = exclusions.get(member.splitId);
    if (existing === undefined) exclusions.set(member.splitId, [member.documentId]);
    else existing.push(member.documentId);
  }

  const splits: SplitQueryTarget[] = liveSplits.map((split) => ({
    objectKey: split.objectKey,
    excludeDocumentIds: exclusions.get(split.id) ?? [],
  }));

  return port.query({
    firmId: input.firmId,
    corpus: input.corpus,
    text: input.text,
    mode: "keyword",
    limit: input.limit,
    splits,
  });
}
