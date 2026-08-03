import {
  found,
  indexed,
  removed,
  searchAdapterError,
  searchEngineNotImplemented,
  type IndexResult,
  type RemoveResult,
  type SearchHit,
  type SearchIndexPort,
  type SearchQueryResult,
} from "@magna-carta/search/port";
import type { Bindings } from "../app.ts";

// The engine SearchIndexPort: forward each operation to the dedicated search worker (magna-carta-search)
// over its service binding, as a JSON request, and read the typed result back. Never throws — a
// transport or engine failure maps to adapter-error (the integrations Dispatch discipline, matching the
// conversion engine's contract), so a caller pattern-matches rather than catches. The worker owns the
// Tantivy Container (crates/search-core) and range-reads the split object keys the caller passed from
// the catalog; this adapter is a thin marshaller and holds no firm state.
function serviceBindingPort(search: Pick<Fetcher, "fetch">): SearchIndexPort {
  async function post(path: string, body: unknown): Promise<Response> {
    return search.fetch(
      new Request(`https://search/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }
  return {
    async index(input): Promise<IndexResult> {
      try {
        const response = await post("index", {
          firmId: input.firmId,
          matterId: input.matterId,
          documentId: input.documentId,
          version: input.version,
          passages: input.passages,
        });
        if (!response.ok) return searchAdapterError(`search service ${response.status}`);
        const published = (await response.json()) as {
          objectKey: string;
          documentCount: number;
          sizeBytes: number;
          schemaGeneration: number;
        };
        return indexed(published);
      } catch (error) {
        return searchAdapterError(error instanceof Error ? error.message : "search service error");
      }
    },
    async remove(input): Promise<RemoveResult> {
      try {
        const response = await post("remove", {
          firmId: input.firmId,
          matterId: input.matterId,
          documentId: input.documentId,
        });
        if (!response.ok) return searchAdapterError(`search service ${response.status}`);
        return removed();
      } catch (error) {
        return searchAdapterError(error instanceof Error ? error.message : "search service error");
      }
    },
    async query(input): Promise<SearchQueryResult> {
      try {
        const response = await post("query", {
          firmId: input.firmId,
          matterId: input.matterId,
          text: input.text,
          mode: input.mode,
          limit: input.limit,
          splitKeys: input.splitKeys,
        });
        if (!response.ok) return searchAdapterError(`search service ${response.status}`);
        const body = (await response.json()) as { hits: SearchHit[] };
        return found(body.hits);
      } catch (error) {
        return searchAdapterError(error instanceof Error ? error.message : "search service error");
      }
    },
  };
}

// The deferred port for when the search worker's service binding is absent (every test environment, and
// prod until that worker is deployed + bound): every operation is engine-not-implemented. The catalog
// still functions — a query resolves the live splits and then reports the engine is not yet reachable,
// rather than crashing — exactly as the conversion subsystem is wired-but-dormant.
const deferredPort: SearchIndexPort = {
  index: () => Promise.resolve(searchEngineNotImplemented()),
  remove: () => Promise.resolve(searchEngineNotImplemented()),
  query: () => Promise.resolve(searchEngineNotImplemented()),
};

// Resolve the SearchIndexPort to the search worker when its binding is present, else the deferred port.
export function resolveSearchIndexPort(env: Bindings): SearchIndexPort {
  return env.SEARCH_SERVICE === undefined ? deferredPort : serviceBindingPort(env.SEARCH_SERVICE);
}
