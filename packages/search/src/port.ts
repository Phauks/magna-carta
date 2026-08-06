import type { FileId, FirmId } from "@magna-carta/identifiers/types";
import type { CorpusScope } from "./corpus.ts";

// SearchIndexPort is the single chokepoint every discovery-search feature reaches the index through,
// named in our domain vocabulary — never a vendor's, never the engine's. It has three operations:
// feed a document's passages into the index (`index`), remove a document (`remove`), and query a
// corpus (`query`). Every operation returns a typed outcome, never a thrown error (the same discipline
// as ConversionPort and the integrations Dispatch): an engine or transport failure becomes a
// first-class result, so a caller pattern-matches rather than catches.
//
// The port is the seam between the app Worker (which owns the per-firm catalog and isolation) and the
// dedicated search Worker's Container (which owns the Tantivy engine, `crates/search-core`). Until that
// Container is deployed, `resolveSearchIndexPort` returns a deferred port whose every operation reports
// `engine-not-implemented`, exactly as the conversion subsystem is wired-but-dormant.

// One extracted passage on its way into the index — the searchable text plus the pointer a hit carries
// back. A passage, not a whole document, is the semantic unit: the same chunking the semantic half embeds.
export interface Passage {
  readonly chunkId: string;
  readonly text: string;
  // The 1-based page the passage came from, when known — carried through to a hit for display.
  readonly page?: number;
}

export interface IndexDocumentInput {
  readonly firmId: FirmId;
  // Which corpus this document is being indexed into — the index's partition key, and the input the
  // split's R2 key is derived from (corpus.ts, split.ts). The same document can belong to more than one
  // corpus, and is then indexed once per corpus into its own split.
  readonly corpus: CorpusScope;
  // A "document" here is the File Manager file the corpus is made of (packages/file-manager); its
  // committed versions are what actually get indexed, one split each.
  readonly documentId: FileId;
  // The file's version number; indexing is idempotent on documentId + version, so a retry or a
  // re-index converges rather than duplicating.
  readonly version: number;
  // Where the engine writes the built split, derived by the caller (@magna-carta/search/split). The
  // caller names the key for the same reason it names the split keys a query reads: it is the side that
  // owns firm scoping and the catalog, so the engine never chooses where a firm's bytes land. Deriving
  // the key from documentId + version is also what makes a retry overwrite its own object.
  readonly objectKey: string;
  readonly passages: readonly Passage[];
}

export interface RemoveDocumentInput {
  readonly firmId: FirmId;
  // Removal is per corpus, never global: a document that belongs to two corpora leaves one of them
  // without leaving the other.
  readonly corpus: CorpusScope;
  readonly documentId: FileId;
}

// Which index halves a query runs. `keyword` is Tantivy/BM25 only; `semantic` is Vectorize only;
// `hybrid` runs both and fuses their rankings. Keyword is the slice that exists today.
export type SearchMode = "keyword" | "semantic" | "hybrid";

export interface SearchQueryInput {
  readonly firmId: FirmId;
  // The corpus the query runs over. A query never spans corpora — that is the isolation the scope key
  // exists for, so material held in one corpus cannot surface in a search of another.
  readonly corpus: CorpusScope;
  readonly text: string;
  readonly mode: SearchMode;
  readonly limit: number;
  // The R2 object keys of the corpus's live splits, resolved by the caller from the per-firm catalog.
  // The keyword engine range-reads exactly these; the caller owns catalog enumeration and firm scoping,
  // so the engine never needs to reach the per-firm database. Empty for a `semantic`-only query.
  readonly splitKeys: readonly string[];
}

// A ranked result. Carries only the pointers needed to hydrate the passage through the data-access
// layer — never its text, which is re-read from R2.
export interface SearchHit {
  readonly documentId: FileId;
  readonly chunkId: string;
  readonly score: number;
}

// The metadata of a split the engine just published, which the caller records in the catalog. `index`
// builds the split and writes it to R2; the caller inserts this row so a later query can find it.
export interface PublishedSplit {
  // Echoes back the key the engine was told to write — confirmation of where the bytes landed, which is
  // what the catalog records.
  readonly objectKey: string;
  readonly documentCount: number;
  readonly sizeBytes: number;
  readonly schemaGeneration: number;
}

// A failure the whole port shares. `engine-not-implemented` is a first-class state because the engine
// Container is deferred; `adapter-error` carries a transport/engine detail for the log. The failure
// shape is identical across every operation, so it is one type: a value of it is assignable to each
// result union below, which is why the failure constructors need no generic.
export type SearchFailureReason = "engine-not-implemented" | "adapter-error";

export interface SearchFailure {
  readonly ok: false;
  readonly reason: SearchFailureReason;
  readonly detail?: string;
}

export type IndexResult = { readonly ok: true; readonly published: PublishedSplit } | SearchFailure;

export type RemoveResult = { readonly ok: true } | SearchFailure;

export type SearchQueryResult =
  | { readonly ok: true; readonly hits: readonly SearchHit[] }
  | SearchFailure;

export interface SearchIndexPort {
  index(input: IndexDocumentInput): Promise<IndexResult>;
  remove(input: RemoveDocumentInput): Promise<RemoveResult>;
  query(input: SearchQueryInput): Promise<SearchQueryResult>;
}

// ── Smart constructors ──────────────────────────────────────────────────────

export function indexed(published: PublishedSplit): IndexResult {
  return { ok: true, published };
}

export function removed(): RemoveResult {
  return { ok: true };
}

export function found(hits: readonly SearchHit[]): SearchQueryResult {
  return { ok: true, hits };
}

// The deferred state, shared across operations: the engine Container is not yet reachable. The returned
// failure is assignable to any of the three result unions, so every operation can `return` it directly.
export function searchEngineNotImplemented(): SearchFailure {
  return { ok: false, reason: "engine-not-implemented" };
}

export function searchAdapterError(detail: string): SearchFailure {
  return { ok: false, reason: "adapter-error", detail };
}
