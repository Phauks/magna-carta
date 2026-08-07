import {
  DECLARED_METADATA_FIELDS,
  type DeclaredMetadataField,
  type MetadataFilter,
} from "./filter-construction.ts";
import type { SyntheticDocument } from "./synthetic-corpus.ts";

// An in-memory reference model of the managed index's DOCUMENTED behavior: equality filters over the
// declared metadata schema that fail closed, a rejection (not a silent ignore) for an unknown field or
// a malformed filter, and a sync boundary behind which the index is stale — a put or a delete is not
// visible to queries until the next sync, exactly as the hourly-sync managed service behaves.
//
// What this model proves is bounded, and the boundary matters: probes passing against it prove that
// OUR protocol, filter shapes, and delete discipline are coherent and that the probes can detect every
// failure shape they exist to find (the broken variants below). They prove nothing about the live
// service, whose actual semantics are precisely the open question — the live verification run replays
// this same protocol against the real binding through the same WallProbeEngine seam.

export interface EngineSearchRequest {
  readonly query: string;
  // Untyped on purpose: the fail-open probe must be able to send an unknown-field filter and a
  // syntactically malformed one, which a MetadataFilter type would make unrepresentable.
  readonly filters?: unknown;
  readonly maxNumResults: number;
  readonly matchThreshold: number;
}

export interface EngineHit {
  readonly objectKey: string;
  readonly score: number;
}

export type EngineSearchResult =
  | { readonly ok: true; readonly hits: readonly EngineHit[] }
  | { readonly ok: false; readonly error: string };

// The seam the probes run through. Locally the reference model implements it; on the live run a thin
// adapter over the real search binding implements it, and the protocol is identical.
export interface WallProbeEngine {
  search(request: EngineSearchRequest): Promise<EngineSearchResult>;
}

// A filter is valid when every key is a declared field and every value is exactly { $eq: string }.
// This validator is the executable statement of the semantics the live service MUST exhibit for the
// wall probes to pass: anything else — unknown fields tolerated, malformed shapes coerced — is the
// fail-open behavior the probe exists to catch.
export function validateFilterAgainstDeclaredSchema(
  filters: unknown,
):
  | { readonly ok: true; readonly filter: MetadataFilter }
  | { readonly ok: false; readonly error: string } {
  if (filters === undefined) return { ok: true, filter: {} };
  if (typeof filters !== "object" || filters === null || Array.isArray(filters)) {
    return { ok: false, error: "malformed filter: not an object of field conditions" };
  }
  const declared = new Set<string>(DECLARED_METADATA_FIELDS);
  const validated: Partial<Record<DeclaredMetadataField, { readonly $eq: string }>> = {};
  for (const [field, condition] of Object.entries(filters)) {
    if (!declared.has(field)) {
      return { ok: false, error: `unknown metadata field: ${field}` };
    }
    if (
      typeof condition !== "object" ||
      condition === null ||
      Array.isArray(condition) ||
      Object.keys(condition).length !== 1 ||
      typeof (condition as { $eq?: unknown }).$eq !== "string"
    ) {
      return { ok: false, error: `malformed condition for field: ${field}` };
    }
    validated[field as DeclaredMetadataField] = {
      $eq: (condition as { $eq: string }).$eq,
    };
  }
  return { ok: true, filter: validated };
}

interface IndexedDocument {
  readonly document: SyntheticDocument;
  readonly tokens: ReadonlySet<string>;
}

function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

// Lexical overlap scoring: the fraction of query tokens present in the document. Deliberately simple —
// the probes assert which MATTERS hits resolve to, never ranking quality, so any scorer that ranks a
// verbatim passage's own document first and gives unrelated documents nonzero overlap serves.
function score(queryTokens: readonly string[], documentTokens: ReadonlySet<string>): number {
  if (queryTokens.length === 0) return 0;
  let matched = 0;
  for (const token of queryTokens) {
    if (documentTokens.has(token)) matched += 1;
  }
  return matched / queryTokens.length;
}

// The index half of the seam: the feed writer's put/delete plus the sync boundary. Probes that
// exercise deletion residue drive this interface; the live adapter maps it onto R2 writes and the
// instance's sync trigger.
export interface WallProbeIndex extends WallProbeEngine {
  put(document: SyntheticDocument): void;
  delete(objectKey: string): void;
  sync(): void;
}

export class ReferenceIndex implements WallProbeIndex {
  private readonly searchable = new Map<string, IndexedDocument>();
  private readonly pendingPuts = new Map<string, SyntheticDocument>();
  private readonly pendingDeletes = new Set<string>();
  lastRequest: EngineSearchRequest | undefined;

  put(document: SyntheticDocument): void {
    this.pendingPuts.set(document.objectKey, document);
  }

  delete(objectKey: string): void {
    this.pendingPuts.delete(objectKey);
    this.pendingDeletes.add(objectKey);
  }

  sync(): void {
    for (const [objectKey, document] of this.pendingPuts) {
      this.searchable.set(objectKey, { document, tokens: new Set(tokenize(document.text)) });
    }
    this.pendingPuts.clear();
    for (const objectKey of this.pendingDeletes) {
      this.searchable.delete(objectKey);
    }
    this.pendingDeletes.clear();
  }

  search(request: EngineSearchRequest): Promise<EngineSearchResult> {
    this.lastRequest = request;
    const validation = validateFilterAgainstDeclaredSchema(request.filters);
    if (!validation.ok) return Promise.resolve({ ok: false, error: validation.error });

    const conditions = Object.entries(validation.filter) as readonly [
      DeclaredMetadataField,
      { readonly $eq: string },
    ][];
    const queryTokens = tokenize(request.query);
    const hits: EngineHit[] = [];
    for (const { document, tokens } of this.searchable.values()) {
      // Fail-closed equality: every condition must match the stamped metadata exactly. A document
      // missing a filtered field is excluded, never included.
      const inScope = conditions.every(
        ([field, condition]) => document.metadata[field] === condition.$eq,
      );
      if (!inScope) continue;
      const documentScore = score(queryTokens, tokens);
      if (documentScore < request.matchThreshold) continue;
      if (documentScore === 0) continue;
      hits.push({ objectKey: document.objectKey, score: documentScore });
    }
    const ranked = hits
      .toSorted((left, right) => right.score - left.score)
      .slice(0, request.maxNumResults);
    return Promise.resolve({ ok: true, hits: ranked });
  }
}

export function referenceIndexOver(documents: readonly SyntheticDocument[]): ReferenceIndex {
  const index = new ReferenceIndex();
  for (const document of documents) index.put(document);
  index.sync();
  return index;
}

// ── Broken variants ─────────────────────────────────────────────────────────
//
// Each models one failure shape the wall probes exist to detect. A probe suite that passes against
// the reference model but does NOT fail against every one of these proves nothing — the sensitivity
// tests run each probe against each variant and assert the failure is caught.

// The dangerous shape: the filter is accepted and silently ignored, so every query is firm-wide.
export function filterIgnoringEngine(reference: ReferenceIndex): WallProbeEngine {
  return {
    search: (request) => reference.search({ ...request, filters: undefined }),
  };
}

// Fail-open on an unknown field: instead of rejecting, the unknown condition is dropped and the rest
// of the filter (possibly empty) is applied.
export function unknownFieldDroppingEngine(reference: ReferenceIndex): WallProbeEngine {
  return {
    search: (request) => {
      const declared = new Set<string>(DECLARED_METADATA_FIELDS);
      let filters = request.filters;
      if (typeof filters === "object" && filters !== null && !Array.isArray(filters)) {
        filters = Object.fromEntries(
          Object.entries(filters).filter(([field]) => declared.has(field)),
        );
      }
      return reference.search({ ...request, filters });
    },
  };
}

// Fail-open on a malformed filter: instead of rejecting, the filter is discarded entirely.
export function malformedFilterDroppingEngine(reference: ReferenceIndex): WallProbeEngine {
  return {
    search: (request) => {
      const validation = validateFilterAgainstDeclaredSchema(request.filters);
      return reference.search({
        ...request,
        filters: validation.ok ? request.filters : undefined,
      });
    },
  };
}

// Deletes never take effect — the residue shape: a removed document keeps being returned forever.
export function deletionIgnoringIndex(documents: readonly SyntheticDocument[]): WallProbeIndex {
  const inner = referenceIndexOver(documents);
  return {
    put: (document) => {
      inner.put(document);
    },
    delete: () => {
      // Dropped on the floor: the failure being modeled.
    },
    sync: () => {
      inner.sync();
    },
    search: (request) => inner.search(request),
  };
}

// A response cache keyed on query text alone, blind to the filter — the cross-scope bleed shape: an
// identical question asked under a different matter receives the first matter's hits.
export function queryTextCachingEngine(reference: ReferenceIndex): WallProbeEngine {
  const cache = new Map<string, EngineSearchResult>();
  return {
    search: async (request) => {
      const cached = cache.get(request.query);
      if (cached !== undefined) return cached;
      const result = await reference.search(request);
      cache.set(request.query, result);
      return result;
    },
  };
}
