import { deriveIdentifier } from "@magna-carta/identifiers/generate";
import type { FileId, IndexSplitId } from "@magna-carta/identifiers/types";
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
