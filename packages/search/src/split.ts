import { deriveIdentifier } from "@magna-carta/identifiers/generate";
import type { FileId, IndexSplitId, ReviewDocumentId } from "@magna-carta/identifiers/types";
import type { CorpusScope } from "./corpus.ts";

// Where a split lives and what it is called. Both answers are DERIVED, never minted, and that is the
// whole idempotency story of the write pipeline: the same document version always resolves to the same
// split id and therefore the same R2 key, so a retried index job overwrites its own half-finished object
// and replaces its own catalog row rather than leaving a second copy behind. A minted id would make
// every retry a new split and every failure a leak.

// The R2 key prefix a corpus's splits live under. Firm scoping is the bucket itself (each firm's bytes
// are in that firm's bucket), so the key only has to separate corpora from each other and splits from
// every other artifact prefix in the bucket.
//
// The corpus IDENTIFIER alone names the prefix — the corpus kind is not a path segment. It does not need
// to be: an identifier is a self-describing handle (`matter_…`), so ids of two kinds can never collide,
// and adding the kind as a segment would buy nothing while changing the key of every split that has ever
// been published. Because this key is derived rather than stored, its exact bytes are a compatibility
// contract with the objects already in the bucket, pinned in the tests beside this file.
export function corpusSplitPrefix(corpus: CorpusScope): string {
  return `search/${corpus.id}/splits/`;
}

// The object key for one split. Kept in lockstep with corpusSplitPrefix so a prefix list finds exactly
// the keys this function produces.
export function splitObjectKey(corpus: CorpusScope, splitId: IndexSplitId): string {
  return `${corpusSplitPrefix(corpus)}${splitId}.split`;
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

// The split id for one REVIEW DOCUMENT, which needs no version because it already is one.
//
// A review document pins the file version it points at, at the moment it was loaded — that pin is the
// whole reason a corpus a firm certified does not change when somebody uploads a newer draft. So the
// review document id names exactly one set of bytes forever, and hashing a version beside it would be
// hashing a constant. Re-processing the SAME review document (a newly deployed engine draining a
// parked backlog) therefore derives the same split id, overwrites its own object, and replaces its own
// catalog row, which is the same convergence the version-keyed derivation buys a matter's files.
//
// The domain word is in the hash so the two derivations can never collide even if an identifier scheme
// ever produced the same token for a file and a review document.
export function splitIdentifierForReviewDocument(
  reviewDocumentId: ReviewDocumentId,
): Promise<IndexSplitId> {
  return deriveIdentifier("indexSplit", `reviewDocument:${reviewDocumentId}`);
}

// The split id for a COMPACTED split, derived from the corpus and the exact set of splits merged into it.
//
// Derived for the same reason the per-document id is derived, and it buys the same thing: a compaction
// pass that dies after writing its object but before committing the catalog swap will, on retry, select
// the same source splits (the selection is ordered and bounded, not arbitrary), compute the same id, and
// overwrite its own half-written object. A minted id would leave every abandoned attempt as bytes in the
// firm's bucket that no catalog row names and no sweep can recognize as garbage.
//
// The source ids are sorted before hashing, so the id depends on WHICH splits were merged and not on the
// order they came back in. The corpus is in the hash as well: two corpora that happened to merge splits
// with the same ids are different splits and must not collide on a key.
export function splitIdentifierForCompaction(
  corpus: CorpusScope,
  sourceSplitIds: readonly IndexSplitId[],
): Promise<IndexSplitId> {
  const ordered = [...sourceSplitIds].sort();
  return deriveIdentifier("indexSplit", `compaction:${corpus.id}:${ordered.join(",")}`);
}
