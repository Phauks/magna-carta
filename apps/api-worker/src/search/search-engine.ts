import {
  compacted,
  found,
  indexed,
  removed,
  searchAdapterError,
  searchEngineNotImplemented,
  type CompactResult,
  type CompactedSplit,
  type IndexResult,
  type RemoveResult,
  type SearchHit,
  type SearchIndexPort,
  type SearchQueryResult,
} from "@magna-carta/search/port";
import type { CorpusScope } from "@magna-carta/search/corpus";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../bindings.ts";
import {
  SPLIT_OBJECT_HOST,
  SPLIT_OBJECT_PATH_PREFIX,
  SPLIT_OBJECT_TOKEN_HEADER,
} from "./split-object-host.ts";
import { mintSplitObjectToken } from "./split-object-token.ts";

// How long a split-object capability token lives. A read token covers one query, which is one engine
// operation and a handful of ranged reads; a write token covers one index or compaction pass, which
// reads its sources and writes a merged object and so needs the longer window. Both are short because
// the token's entire life is the operation it was minted for — it is not a session.
const READ_TOKEN_WINDOW_MILLISECONDS = 2 * 60 * 1000;
const WRITE_TOKEN_WINDOW_MILLISECONDS = 15 * 60 * 1000;

// How the engine reaches a firm's split objects. The engine holds no R2 credentials: it issues ordinary
// HTTP against this base and presents this token, and the search worker's container outbound
// interception forwards the call into this Worker's split-object host (split-object-host.ts), which
// resolves the firm's bucket and turns each request into exactly one R2 operation.
interface SplitObjectAccess {
  readonly baseUrl: string;
  readonly tokenHeader: string;
  readonly token: string;
}

async function splitObjectAccess(
  env: { AUTH_SECRET: string },
  firmId: FirmId,
  corpus: CorpusScope,
  write: boolean,
): Promise<SplitObjectAccess> {
  const window = write ? WRITE_TOKEN_WINDOW_MILLISECONDS : READ_TOKEN_WINDOW_MILLISECONDS;
  return {
    baseUrl: `http://${SPLIT_OBJECT_HOST}${SPLIT_OBJECT_PATH_PREFIX}`,
    tokenHeader: SPLIT_OBJECT_TOKEN_HEADER,
    token: await mintSplitObjectToken(
      {
        firmId,
        corpusKind: corpus.kind,
        corpusId: corpus.id,
        write,
        exp: Date.now() + window,
      },
      env,
    ),
  };
}

// The engine SearchIndexPort: forward each operation to the dedicated search worker (magna-carta-search)
// over its service binding, as a JSON request, and read the typed result back. Never throws — a
// transport or engine failure maps to adapter-error (the integrations Dispatch discipline, matching the
// conversion engine's contract), so a caller pattern-matches rather than catches. The worker owns the
// Tantivy Container (crates/search-core) and range-reads the split object keys the caller passed from
// the catalog; this adapter is a thin marshaller and holds no firm state.
//
// It does hold one thing the engine cannot: the capability to reach the firm's objects. Every operation
// that touches R2 carries a freshly minted, corpus-scoped token, so the engine's reach is bounded by the
// call it was given rather than by a credential it keeps.
function serviceBindingPort(
  search: Pick<Fetcher, "fetch">,
  env: { AUTH_SECRET: string },
): SearchIndexPort {
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
          corpus: input.corpus,
          documentId: input.documentId,
          version: input.version,
          objectKey: input.objectKey,
          passages: input.passages,
          objectAccess: await splitObjectAccess(env, input.firmId, input.corpus, true),
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
          corpus: input.corpus,
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
          corpus: input.corpus,
          text: input.text,
          mode: input.mode,
          limit: input.limit,
          // Each split travels with its own exclusions. The engine applies them per split as it reads it,
          // because the same document is legitimately live at a newer version in a different split.
          splits: input.splits,
          // Read-only: a query must not be able to overwrite the splits it is reading.
          objectAccess: await splitObjectAccess(env, input.firmId, input.corpus, false),
        });
        if (!response.ok) return searchAdapterError(`search service ${response.status}`);
        const body = (await response.json()) as { hits: SearchHit[] };
        return found(body.hits);
      } catch (error) {
        return searchAdapterError(error instanceof Error ? error.message : "search service error");
      }
    },
    async compact(input): Promise<CompactResult> {
      try {
        const response = await post("compact", {
          firmId: input.firmId,
          corpus: input.corpus,
          sources: input.sources,
          objectKey: input.objectKey,
          objectAccess: await splitObjectAccess(env, input.firmId, input.corpus, true),
        });
        if (!response.ok) return searchAdapterError(`search service ${response.status}`);
        const published = (await response.json()) as CompactedSplit;
        return compacted(published);
      } catch (error) {
        return searchAdapterError(error instanceof Error ? error.message : "search service error");
      }
    },
  };
}

// The deferred port for a deployment whose search worker binding is absent: every operation is
// engine-not-implemented. The catalog still functions — a query resolves the live splits and then
// reports the engine is not yet reachable, rather than crashing — exactly as the conversion subsystem
// is wired-but-dormant. A deployment that binds the worker never resolves this port, so a worker that
// is bound and not answering reads as adapter-error, which a consumer retries.
const deferredPort: SearchIndexPort = {
  index: () => Promise.resolve(searchEngineNotImplemented()),
  remove: () => Promise.resolve(searchEngineNotImplemented()),
  query: () => Promise.resolve(searchEngineNotImplemented()),
  compact: () => Promise.resolve(searchEngineNotImplemented()),
};

// Resolve the SearchIndexPort to the search worker when its binding is present, else the deferred port.
export function resolveSearchIndexPort(env: Bindings): SearchIndexPort {
  return env.SEARCH_SERVICE === undefined
    ? deferredPort
    : serviceBindingPort(env.SEARCH_SERVICE, env);
}
