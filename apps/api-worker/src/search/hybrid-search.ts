import { reciprocalRankFusion } from "@magna-carta/search/fusion";
import { found, type SearchHit, type SearchQueryResult } from "@magna-carta/search/port";
import type { Bindings } from "../bindings.ts";
import { runKeywordSearch, type KeywordSearchInput } from "./keyword-search.ts";
import { deferredSemanticSearch } from "./semantic-search.ts";

// One half of a hybrid search: it returns its ranked hits or a typed failure. The keyword half is the
// Tantivy engine reached through the catalog (runKeywordSearch); the semantic half is Vectorize. Either
// may be deferred (its engine not yet deployed) or error, in which case the other half still answers —
// which is exactly why reciprocal rank fusion is the right combiner: it degrades to whichever half has
// signal without any score calibration.
export type SearchHalf = (env: Bindings, input: KeywordSearchInput) => Promise<SearchQueryResult>;

// Run a hybrid keyword + semantic search and fuse the two rankings by reciprocal rank. Both halves run
// concurrently; a half that succeeds contributes its hits, a half that is deferred or errors simply
// contributes nothing. If BOTH halves are unavailable the primary (keyword) failure is returned, so the
// caller sees a real reason rather than an empty success. The halves are injectable so the composition
// is testable without either engine Container.
export async function runHybridSearch(
  env: Bindings,
  input: KeywordSearchInput,
  keyword: SearchHalf = runKeywordSearch,
  semantic: SearchHalf = deferredSemanticSearch,
): Promise<SearchQueryResult> {
  const [keywordResult, semanticResult] = await Promise.all([
    keyword(env, input),
    semantic(env, input),
  ]);

  const lists: SearchHit[][] = [];
  if (keywordResult.ok) lists.push([...keywordResult.hits]);
  if (semanticResult.ok) lists.push([...semanticResult.hits]);

  // Neither half answered: surface the keyword half's failure (the primary), not an empty success.
  if (lists.length === 0) return keywordResult;

  const fused = reciprocalRankFusion(lists).slice(0, input.limit);
  return found(fused);
}
