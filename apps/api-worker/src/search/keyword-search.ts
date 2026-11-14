import {
  listLiveSplitsForCorpus,
  listMattersWithLiveSplits,
  listStaleMembersForCorpus,
  type IndexedDocumentId,
} from "@magna-carta/data-access/index-split-statements";
import type { FileId, FirmId, IndexSplitId, MatterId } from "@magna-carta/identifiers/types";
import { corpusOfMatter, type CorpusScope } from "@magna-carta/search/corpus";
import type {
  SearchHit,
  SearchIndexPort,
  SearchQueryResult,
  SplitQueryTarget,
} from "@magna-carta/search/port";
import type { Bindings } from "../bindings.ts";
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
  // THE ISOLATION, and it is one clause rather than a rule anybody has to follow: the catalog is
  // enumerated by CORPUS, so a query is handed the keys of the corpus it was asked about and there is
  // no wording of it that reaches another's. A matter search cannot name a review set's splits, which
  // is what makes material an opposing party produced under a protective order unreachable from the
  // ordinary matter surface rather than merely absent from it.
  const [liveSplits, staleMembers] = await Promise.all([
    listLiveSplitsForCorpus(database, input.corpus.id),
    // The second catalog read, and it is what keeps a re-indexed document from matching its own stale
    // passages. A compacted split is immutable while the corpus is not: it still holds the passages of
    // every version it was merged from, so when one of those documents is re-indexed both the new
    // per-document split and the old text inside the merged split are live until the next compaction
    // repacks it. Naming the superseded ids per split is what makes the old text stop matching in the
    // meantime — and it has to be per split, because the same document is legitimately live at a newer
    // version in a different one.
    listStaleMembersForCorpus(database, input.corpus.id),
  ]);

  const exclusions = new Map<IndexSplitId, IndexedDocumentId[]>();
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

export interface KeywordSearchOverMattersInput {
  readonly firmId: FirmId;
  readonly matterIds: readonly MatterId[];
  readonly text: string;
  readonly limit: number;
}

// The same keyword search asked of several matters, each of its own corpus, and answered as one
// list.
//
// ONE QUESTION A MATTER, AND NEVER ONE QUESTION OF SEVERAL. A query names one corpus and is handed
// that corpus's split keys with a token that reaches no other, which is the isolation that keeps a
// review set out of a matter search. This does not loosen it: every matter is asked through
// `runKeywordSearch` exactly as its own search asks it, and what is new is only that the answers are
// put together afterwards. So the cost is one engine call a matter, and the caller is what keeps
// the matters few.
//
// A matter with nothing indexed is not asked. One catalog read says which of the matters hold a
// live split, and for a client with thirty matters and files indexed on four that is four engine
// calls instead of thirty.
//
// ANY ONE FAILURE IS THE ANSWER. A list put together from the matters that happened to answer
// would read as complete and leave out a matter nobody could name, so a matter that cannot be
// searched fails the whole question and the reader is told the files could not be searched.
//
// The scores the lists are merged by come from separate indexes, each scoring against its own
// documents, so they are not on one scale. They put the strongest passages first and no more is
// claimed of the order.
export async function runKeywordSearchOverMatters(
  env: Bindings,
  input: KeywordSearchOverMattersInput,
  port: SearchIndexPort = resolveSearchIndexPort(env),
): Promise<SearchQueryResult> {
  const database = firmDatabaseFor(env.FIRM_DATABASE, input.firmId);
  const indexed = await listMattersWithLiveSplits(database, input.matterIds);
  const results = await Promise.all(
    indexed.map((matterId) =>
      runKeywordSearch(
        env,
        {
          firmId: input.firmId,
          corpus: corpusOfMatter(matterId),
          text: input.text,
          limit: input.limit,
        },
        port,
      ),
    ),
  );
  const hits: SearchHit[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    hits.push(...result.hits);
  }
  // Best first. A stable sort, so passages one index scored alike stay in the order it gave them.
  const bestFirst = hits.toSorted((left, right) => right.score - left.score);
  return { ok: true, hits: bestFirst.slice(0, input.limit) };
}
