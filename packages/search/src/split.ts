import { deriveIdentifier } from "@magna-carta/identifiers/generate";
import type { FileId, IndexSplitId, MatterId } from "@magna-carta/identifiers/types";

// Where a split lives and what it is called. Both answers are DERIVED, never minted, and that is the
// whole idempotency story of the write pipeline: the same document version always resolves to the same
// split id and therefore the same R2 key, so a retried index job overwrites its own half-finished object
// and replaces its own catalog row rather than leaving a second copy behind. A minted id would make
// every retry a new split and every failure a leak.

// The R2 key prefix a matter's splits live under. Firm scoping is the bucket itself (each firm's bytes
// are in that firm's bucket), so the key only has to separate matters from each other and splits from
// every other artifact prefix in the bucket.
export function matterSplitPrefix(matterId: MatterId): string {
  return `search/${matterId}/splits/`;
}

// The object key for one split. Kept in lockstep with matterSplitPrefix so a prefix list finds exactly
// the keys this function produces.
export function splitObjectKey(matterId: MatterId, splitId: IndexSplitId): string {
  return `${matterSplitPrefix(matterId)}${splitId}.split`;
}

// The split id for one document version. Hashing (rather than concatenating) the two inputs is what
// keeps the handle in the standard shape — a validated `indexSplit_` handle of the ordinary token
// length — while still being reproducible from the inputs alone.
export function splitIdentifierForDocumentVersion(
  documentId: FileId,
  version: number,
): Promise<IndexSplitId> {
  return deriveIdentifier("indexSplit", `${documentId}:${version}`);
}
