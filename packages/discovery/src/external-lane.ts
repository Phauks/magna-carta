import type { ReviewSetId } from "@magna-carta/identifiers/types";
import type { DiscoveryLoadRow } from "./load-statements.ts";
import { reconcileLoad, type LoadReconciliation } from "./load-service.ts";

// The external lane: a production received from another party. DISCOVERY ADDS NOTHING TO THE
// TRANSFER — the bytes take the same direct-to-R2 path every other upload takes, cross the same
// quarantine gate, get sniffed against their real bytes, hashed, and scanned. Untrusted bytes from an
// opposing party are precisely the case that gate exists for, and discovery has no bypass of it,
// including for entries expanded out of an archive.
//
// What discovery adds is a DESTINATION and a RECORD. The bytes become ordinary File Manager files on
// the matter, under a system-owned folder tree, marked with an origin so the matter's working-file
// surfaces can exclude them by default. One blob store, one scan gate, one version model, one hash,
// one legal-hold mechanism, one destruction policy, one storage-tiering path — and, most importantly,
// exactly one answer to "is this file under hold", which is a question that must not have two.

// The system-owned folder tree loaded bytes land in. Named here rather than in the route so the
// shape of the tree is one fact: `Discovery / <review set name> / <load label>`.
export const DISCOVERY_FOLDER_ROOT_NAME = "Discovery";

export interface DiscoveryDestinationFolderPath {
  readonly segments: readonly string[];
}

// The folder path a load's bytes land under. A load with no label of its own uses its identifier,
// which is stable, unique, and legible in a path — a firm looking at the tree can match a folder to
// a load in the manifest without guessing.
export function discoveryDestinationFolderPath(input: {
  readonly reviewSetName: string;
  readonly loadLabel: string;
}): DiscoveryDestinationFolderPath {
  return {
    segments: [DISCOVERY_FOLDER_ROOT_NAME, input.reviewSetName, input.loadLabel],
  };
}

// The marker that keeps loaded material out of the matter's ordinary file surfaces by default. A
// production of 40,000 documents landing in the matter's document list unannounced is the failure
// this exists to prevent.
export const DISCOVERY_ORIGIN_MARKER = "discovery-load";

// ---------------------------------------------------------------------------------------------
// Reconciliation
//
// The load's declared-versus-actual reconciliation is computed from WHAT ACTUALLY COMMITTED, never
// from what the loader said was coming and never from an accompanying load file. A load file, if one
// arrives with the production, is parsed for its metadata and is NEVER trusted over the bytes: a
// mismatch is an exception, not a correction.

export interface ExternalLoadReconciliation extends LoadReconciliation {
  readonly reviewSetId: ReviewSetId;
  // What the manifest says about the gap, in one sentence a person can read. Null when the
  // declaration and the arrival agree.
  readonly declarationVariance: string | null;
}

export function reconcileExternalLoad(load: DiscoveryLoadRow): ExternalLoadReconciliation {
  const base = reconcileLoad(load);
  const difference = base.loadedDocumentCount - base.declaredDocumentCount;
  return {
    ...base,
    reviewSetId: load.review_set_id,
    declarationVariance:
      difference === 0
        ? null
        : difference > 0
          ? `${difference} more document(s) arrived than were declared`
          : `${-difference} declared document(s) did not arrive`,
  };
}

// Whether a file already present in the review set by content hash is the same material arriving
// again. A re-uploaded file already present by hash is RECOGNIZED rather than duplicated — the scan
// cache already deduplicates the scan by content hash, so a production containing ten thousand copies
// of one exhibit scans it once, and this is the load-time half of the same idea.
export function isAlreadyPresentByHash(
  contentSha256: string | null,
  presentHashes: ReadonlySet<string>,
): boolean {
  if (contentSha256 === null) return false;
  return presentHashes.has(contentSha256);
}

// A flagged file in discovery IS EVIDENCE. Quarantine, never auto-delete: the generic delete-infected
// default is wrong here, destruction is blocked by holds anyway, and the honest outcome is a review
// document present in the corpus and present in the manifest, carrying a malware-flagged exception,
// that no parser opens.
export function scanVerdictAdmitsParsing(scanVerdict: string | null): boolean {
  return scanVerdict === "clean";
}
