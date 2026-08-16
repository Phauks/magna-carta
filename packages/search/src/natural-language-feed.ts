import {
  matterScopedObjectDimensions,
  type ObjectDimensions,
} from "@magna-carta/object-dimensions/dimensions";
import type { FileId, MatterId } from "@magna-carta/identifiers/types";
import type { Passage } from "./port.ts";

// The derived text feed: the ONLY thing that can reach the managed natural-language index, and the
// reason the exclusions in this file are structural rather than a rule somebody has to remember.
//
// WHY A DERIVED FEED AT ALL, rather than pointing the index at the firm's bucket. A firm's bucket is
// not a document library. It holds committed file versions, the mutable working copy of every open
// editing session, conversion artifacts, download bundles, captured email originals, keyword-index
// splits — and the one that decides it, discovery review-set originals: material received from
// opposing parties. Indexing the bucket would put an opponent's production into a search of the
// firm's own working files, and would return hits out of documents nobody has saved.
//
// So nothing reaches the index except by the writer in this file producing an object for it. What
// enters is an ALLOW-LIST with exactly one entry, which is what makes the exclusion of transcripts,
// work product, and received material a fact about the shape of the system rather than a filter
// that could be got wrong. Feeding already-extracted text rather than original bytes is what makes
// the file-size ceiling and the unsupported-format problem disappear as well: `.doc`, `.msg`,
// `.eml`, and WordPerfect are a real fraction of a legal corpus and the source format never leaves
// this platform.

// ── The object key ──────────────────────────────────────────────────────────

// The feed key ENCODES the matter, and the authoritative object key deliberately does not.
//
// That asymmetry is the point rather than an inconsistency. `files/{fileId}/{versionId}` is flat
// precisely so a rename or a matter reassignment moves no bytes; the feed copy is derived and
// disposable, so it is cheap to move and can therefore carry the scope. A reassignment deletes the
// old feed object and writes a new one, and the expensive copy never moves.
//
// The exact bytes are a compatibility contract with every fed object in every firm's bucket, pinned
// in the tests beside this file the same way the split key is.
export const NATURAL_LANGUAGE_FEED_PREFIX = "ai-search/";

export function naturalLanguageFeedPrefixForMatter(matterId: MatterId): string {
  return `${NATURAL_LANGUAGE_FEED_PREFIX}${matterId}/`;
}

export function naturalLanguageFeedObjectKey(
  matterId: MatterId,
  fileId: FileId,
  version: number,
): string {
  return `${naturalLanguageFeedPrefixForMatter(matterId)}${fileId}/${version}.md`;
}

// Every hit the index returns is a pointer — a feed object key — and the matter is recovered from it
// exactly this way before any entitlement re-check. A key that does not parse as a feed key resolves
// to undefined and its hit is dropped, never guessed at: the index is not the authority on anything,
// least of all on which matter a document belongs to.
export function matterOfNaturalLanguageFeedObjectKey(objectKey: string): MatterId | undefined {
  const parts = objectKey.split("/");
  if (parts.length !== 4 || parts[0] !== "ai-search" || parts[3]?.endsWith(".md") !== true) {
    return undefined;
  }
  const matter = parts[1];
  if (matter === undefined || !matter.startsWith("matter_")) return undefined;
  return matter as MatterId;
}

// ── The one object class ────────────────────────────────────────────────────

// The single class the feed writer may emit. The type is the enforcement, not the comment: the
// stamping function below returns this literal, so a reserved class is a compile error rather than
// something a reviewer has to catch.
export const NATURAL_LANGUAGE_FEED_OBJECT_CLASS = "working-document" as const;

// The classes a reader of this index may encounter one day and which this writer must never
// produce. They are listed so the exclusion predicate can be written and asserted before any such
// object exists — a transcript, a piece of work product, or an opposing party's production must
// enter a search scope by somebody's visible choice, never by default.
export const NATURAL_LANGUAGE_RESERVED_OBJECT_CLASSES: readonly string[] = Object.freeze([
  "work-product",
  "transcript",
  "received-material",
]);

// Every object class this writer is capable of producing. Exactly one member, and a fitness test
// asserts that — a second entry here means somebody has widened what can reach the managed index,
// which is the change that most needs to be deliberate.
export const NATURAL_LANGUAGE_FEED_EMITTED_OBJECT_CLASSES: readonly string[] = Object.freeze([
  NATURAL_LANGUAGE_FEED_OBJECT_CLASS,
]);

// ── What a fed object carries ───────────────────────────────────────────────

// The custom metadata stamped on a fed object at put time.
//
// It is built through the one home for object dimensions that every other write path in the
// platform uses, and NOT assembled here. That matters more than it looks: the managed index's
// declared metadata fields `matter` and `object_class` are the same two names the platform already
// stamps on every object in a firm's bucket, so the index reads the platform's own stamp rather
// than a parallel one that could disagree with it.
//
// The remaining two declared fields, `client` and `confidentiality_scope`, are stamped by nothing —
// here or anywhere else. They are declared on the instance because declaring a field later
// re-indexes every firm, and they are left unwritten because there is no populated client link and
// no wall vocabulary yet, and a dimension absent on every object is worse than no dimension: a
// filter on it matches nothing while looking like it works. They join the stamp when the platform's
// own reservation on those two names is lifted, and the backfill that follows is the feed's, not a
// re-index.
//
// The MATTER IS COPIED, never re-derived. The authoritative file-version object carries the matter
// in its own metadata, stamped at put time, and that value is what is copied here. One home per
// fact: the two cannot disagree, and if they ever did, the disagreement is detectable by comparison
// rather than invisible.
export function naturalLanguageFeedObjectDimensions(matterId: MatterId): ObjectDimensions {
  return matterScopedObjectDimensions({
    objectClass: NATURAL_LANGUAGE_FEED_OBJECT_CLASS,
    matterId,
  });
}

// ── The document body ───────────────────────────────────────────────────────

// The fed object's bytes: the per-page extracted text the keyword pipeline has ALREADY computed for
// this same version, concatenated with page markers.
//
// A second consumer of one extraction, never a second extraction. The passages handed here are the
// exact ones built into the keyword split in the same job — the bytes are read once, parsed once,
// and both consumers read the result. Re-extracting would be a second parse of the same untrusted
// document for a derived copy, and would let the two copies disagree about what the document says.
//
// The page marker is a plain Markdown heading rather than a private syntax, because the managed
// service converts and chunks this text with its own reader: a marker it does not understand is a
// marker that lands in the middle of a passage. A passage that knew no page contributes its text
// without a marker rather than an invented page number.
export function naturalLanguageFeedDocument(passages: readonly Passage[]): string {
  const sections: string[] = [];
  let lastPage: number | undefined;
  for (const passage of passages) {
    if (passage.page !== undefined && passage.page !== lastPage) {
      sections.push(`## Page ${passage.page}`);
      lastPage = passage.page;
    }
    sections.push(passage.text);
  }
  return `${sections.join("\n\n")}\n`;
}
