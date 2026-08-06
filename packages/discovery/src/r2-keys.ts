import type {
  DiscoveryLoadId,
  ReviewDocumentId,
  ReviewSetId,
} from "@magna-carta/identifiers/types";

// The R2 layout for everything discovery derives, under the firm's own bucket.
//
// NATIVE BYTES ARE NOT IN THIS LAYOUT. A review document points at a File Manager object at a File
// Manager key; nothing here copies one. That single decision removes the largest storage line
// discovery would otherwise add, and it is also what keeps one answer to "is this file under hold".
//
// Every key is DERIVED from identifiers rather than stored, which is what makes a re-processing land
// on the same object and a replay converge rather than duplicate. Because the key is derived, its
// exact bytes are a compatibility contract with the objects already in the bucket — the fixtures in
// test/r2-keys.test.ts pin them, and changing one is changing where every existing object lives.
//
// A LISTING IS NEVER USED TO ENUMERATE ANYTHING. The database is authoritative for what exists; R2 is
// addressed, not scanned. At the ceiling a single review set has about half a million derived objects
// and a listing walk over them is not a read, it is an outage.

export const DISCOVERY_R2_PREFIX = "discovery";

// The record artifacts. Written once at load completion, never regenerated: a re-processing writes a
// new processing record, while the manifest describes what ARRIVED, which does not change.
export function loadManifestKey(reviewSetId: ReviewSetId, loadId: DiscoveryLoadId): string {
  return `${DISCOVERY_R2_PREFIX}/${reviewSetId}/loads/${loadId}/manifest.json`;
}

// The printable sibling. A firm hands this to opposing counsel, and it has to be readable by somebody
// with no tooling and no account.
export function loadManifestTextKey(reviewSetId: ReviewSetId, loadId: DiscoveryLoadId): string {
  return `${DISCOVERY_R2_PREFIX}/${reviewSetId}/loads/${loadId}/manifest.txt`;
}

export function loadExceptionReportKey(reviewSetId: ReviewSetId, loadId: DiscoveryLoadId): string {
  return `${DISCOVERY_R2_PREFIX}/${reviewSetId}/loads/${loadId}/exceptions.json`;
}

export function loadExceptionReportTextKey(
  reviewSetId: ReviewSetId,
  loadId: DiscoveryLoadId,
): string {
  return `${DISCOVERY_R2_PREFIX}/${reviewSetId}/loads/${loadId}/exceptions.txt`;
}

// The derived artifacts. Collectable when the review set closes, because all three are rebuildable
// from source — closing releases a cache and never a record.
export function reviewDocumentTextKey(
  reviewSetId: ReviewSetId,
  reviewDocumentId: ReviewDocumentId,
): string {
  return `${DISCOVERY_R2_PREFIX}/${reviewSetId}/text/${reviewDocumentId}.txt`;
}

// The per-document metadata sidecar. A production's per-document metadata is open-ended and large, so
// it goes here rather than into an entity-attribute-value table: at the ceiling, 250,000 documents
// times forty attributes is ten million rows bought to provide filtering the index does better.
export function reviewDocumentMetadataKey(
  reviewSetId: ReviewSetId,
  reviewDocumentId: ReviewDocumentId,
): string {
  return `${DISCOVERY_R2_PREFIX}/${reviewSetId}/metadata/${reviewDocumentId}.json`;
}

// The prefix a review set's derived objects live under — what a close sweeps for collection. The
// manifests and exception reports under `loads/` are deliberately NOT under it: they are records.
export function reviewSetDerivedPrefixes(reviewSetId: ReviewSetId): readonly string[] {
  return [
    `${DISCOVERY_R2_PREFIX}/${reviewSetId}/text/`,
    `${DISCOVERY_R2_PREFIX}/${reviewSetId}/metadata/`,
  ];
}
