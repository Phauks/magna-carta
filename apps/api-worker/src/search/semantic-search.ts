import { searchEngineNotImplemented, type SearchQueryResult } from "@magna-carta/search/port";
import type { Bindings } from "../bindings.ts";
import type { KeywordSearchInput } from "./keyword-search.ts";

// The semantic half of discovery search — Vectorize nearest-neighbour over passage embeddings. Unlike
// the keyword half, semantic is Cloudflare-managed (Vectorize), so it is queried here in the app Worker
// rather than in the engine Container: embed the query text through the platform embedding model
// (InferencePort.embed, already the pinned bge-large-en-v1.5) and topK-search the firm's Vectorize
// namespace, then map each match's metadata back to a hit.
//
// It is deferred until that binding is wired: a `VECTORIZE` binding and the per-firm namespace
// allocation are a deploy-time step (like SEARCH_SERVICE and the conversion engines). Until then this
// reports engine-not-implemented, and `runHybridSearch` degrades to keyword-only — the reason RRF
// tolerates one half returning nothing. When the binding lands, the real adapter replaces this default:
// resolve InferencePort, embed `input.text`, `env.VECTORIZE.query(vector, { namespace, topK, returnMetadata })`,
// and map matches to `SearchHit`s (documentId + chunkId from metadata, score from the match).
export function runSemanticSearch(
  _env: Bindings,
  _input: KeywordSearchInput,
): Promise<SearchQueryResult> {
  return Promise.resolve(searchEngineNotImplemented());
}

// The deferred semantic half `runHybridSearch` uses by default until the Vectorize adapter is wired.
export const deferredSemanticSearch = runSemanticSearch;
