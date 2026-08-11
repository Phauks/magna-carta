import type { FileId, MatterId } from "@magna-carta/identifiers/types";

// Fenced harness for the natural-language search index (Cloudflare AI Search over a derived R2 feed).
// The metadata filter a query carries is a recall and cost optimization, NOT the confidentiality
// boundary — read-time re-authorization through the firm-scoped data-access layer is — but the
// retrieval route still must not ship until the filter's semantics are proven against the live
// service: a filter that fails open, or that is accepted and silently ignored, cannot bear even the
// optimization's weight. This module pins, ahead of the build, the exact shapes our side will send:
// the declared metadata schema, the two-key matter-scoped filter, and the feed-object key layout.
// Slice 1's production filter builder and feed writer adopt these shapes verbatim; the live
// verification run replays the same shapes against the real binding. Nothing in this directory is
// exported from the package or reachable from production code.

// The instance's custom metadata schema, declared once at instance creation and closed: changing it
// later triggers a full re-index of every firm's instance, so the field list is a foundation, not a
// setting. Four fields are declared; the fifth slot is deliberately unallocated.
export const DECLARED_METADATA_FIELDS = [
  "matter",
  "client",
  "object_class",
  "confidentiality_scope",
] as const;

export type DeclaredMetadataField = (typeof DECLARED_METADATA_FIELDS)[number];

// The one object class the feed writer may emit. The reserved values exist in the vocabulary so the
// exclusion predicate already runs before any such object could ever exist — but no code path may
// write them, which the stamping function below enforces at the type level: its return type names the
// working-document literal, so a reserved value is a compile error, not a review catch.
export const WORKING_DOCUMENT_OBJECT_CLASS = "working-document" as const;

export const RESERVED_OBJECT_CLASSES = ["work-product", "transcript", "received-material"] as const;

export interface EqualityCondition {
  readonly $eq: string;
}

// A filter is equality conditions on declared fields only — the sole shape the matter-scoped query
// relies on. No disjunction is modeled because none is relied on: disjunction semantics are a separate
// live-verification question and nothing here may depend on the answer.
export type MetadataFilter = Readonly<Partial<Record<DeclaredMetadataField, EqualityCondition>>>;

// The one filter the matter-scoped retrieval route sends: two equality keys, implicit AND. Every value
// is server-derived — the matter handle comes from the authenticated route's path (already authorized
// before any query is built) and the object class is a constant. The signature is the fitness
// property: it accepts a branded matter identifier and nothing else, so no caller-supplied request
// field has a pathway into a filter value.
export function matterScopedFilter(matterHandle: MatterId): MetadataFilter {
  return {
    matter: { $eq: matterHandle },
    object_class: { $eq: WORKING_DOCUMENT_OBJECT_CLASS },
  };
}

// The feed-object key layout. The key deliberately encodes the matter — the feed copy is derived and
// disposable, so a matter reassignment deletes the old key and writes a new one — while the
// authoritative object key stays scope-free. The exact bytes are a compatibility contract with every
// fed object in every firm's bucket, pinned by the tests beside this file the same way the split-key
// derivation is pinned.
export function feedObjectKey(matterId: MatterId, fileId: FileId, version: number): string {
  return `ai-search/${matterId}/${fileId}/${version}.md`;
}

// Every hit the index returns is a pointer — an object key from which the matter is recoverable — and
// the matter is recovered from the key exactly this way before any entitlement re-check. A key that
// does not parse as a feed key resolves to undefined and the hit is dropped, never guessed at.
export function matterOfFeedObjectKey(objectKey: string): MatterId | undefined {
  const parts = objectKey.split("/");
  if (parts.length !== 4 || parts[0] !== "ai-search" || !parts[3]?.endsWith(".md")) {
    return undefined;
  }
  const matter = parts[1];
  if (matter === undefined || !matter.startsWith("matter_")) return undefined;
  return matter as MatterId;
}

// The metadata stamped on every fed object at put time. `matter` is copied from the authoritative
// object's own metadata (never re-derived), `object_class` is the working-document literal by type,
// and `confidentiality_scope` is declared-but-empty until walls are built — declaring it now is free,
// adding it later re-indexes every firm.
export interface FeedObjectMetadata {
  readonly matter: MatterId;
  readonly client: string;
  readonly object_class: typeof WORKING_DOCUMENT_OBJECT_CLASS;
  readonly confidentiality_scope: "";
}

export function feedObjectMetadata(
  matterHandle: MatterId,
  clientHandle: string,
): FeedObjectMetadata {
  return {
    matter: matterHandle,
    client: clientHandle,
    object_class: WORKING_DOCUMENT_OBJECT_CLASS,
    confidentiality_scope: "",
  };
}
