import type { MatterId } from "@magna-carta/identifiers/types";

// THE DIMENSIONS STAMPED ON EVERY OBJECT A FIRM'S BUCKET HOLDS.
//
// An R2 object key in this platform is deliberately opaque and scope-free — `files/{fileId}/{versionId}`
// carries no matter, precisely so a rename or a matter reassignment moves no bytes. That makes the key
// the wrong place to ask "which matter is this?", and the firm's database the right one. But a reader
// that only has the object — a retrieval index reading the bucket, a storage report, an operator
// answering a deletion request — cannot reach the database, and re-deriving the answer for every object
// after the fact means rewriting the metadata of every object a firm has ever written.
//
// So the scope travels WITH the object, in its custom metadata, written at put time. Two dimensions:
// which matter the object belongs to, and what class of object it is. Both are server-derived — no
// value here ever comes from a request body.
//
// ONE SPELLING SERVES BOTH WRITE PATHS. The R2 Workers binding takes these as the `customMetadata`
// record; the S3-compatible API (the presigned PUT a browser uploads to, and the server-side multipart
// create) takes the same pairs as `x-amz-meta-<name>` request headers. The names below are therefore
// lower-case and stable: renaming one orphans the dimension on every object already written.

export const MATTER_DIMENSION = "matter";
export const OBJECT_CLASS_DIMENSION = "object_class";

// Declared, and deliberately NOT written yet. Both are names a reader of these objects may come to
// expect, so they are reserved here rather than left to be invented twice in two places:
//
//   client                — the client entity playing the client role on the matter. There is no
//                           reader for that link yet and no populated data behind it, and a dimension
//                           that is absent on every object is worse than no dimension: a filter on it
//                           matches nothing while looking like it works. It joins the stamp when the
//                           link is wired, and the backfill sweep fills it in for what already exists.
//   confidentiality_scope — the wall group an object sits behind, for when walls are built.
//
// A test asserts no write path emits either, so the reservation is enforced rather than documented.
export const RESERVED_DIMENSIONS: readonly string[] = ["client", "confidentiality_scope"];

// What an object IS, in one closed vocabulary. The class is what lets a reader tell a committed
// document from the half-finished working copy of the same document, and either of those from an
// opponent's production — a distinction no key prefix makes on its own, and the one that decides
// whether an object may ever be fed to anything.
//
// Every class below is stamped by exactly one write path, and the paths are enumerated by the source
// scan in apps/api-worker/test, so this union and the writers cannot drift apart.

// Classes for objects that belong to exactly one matter.
export type MatterScopedObjectClass =
  // A file version in the File Manager: the immutable bytes behind one committed (or committing)
  // version of a document.
  | "working-document"
  // The single mutable working copy of a document with an editing session open. NOT a version:
  // nobody has saved it, and it is overwritten on every keystroke batch.
  | "working-copy"
  // A version's export copy: the same document with every tracked change accepted, produced once
  // when the editor cuts the version and served wherever a copy leaves the platform. DERIVED from
  // the version's own bytes and rebuildable from them; it belongs to the version's matter.
  | "export-copy"
  // A purchased carrier label, when the shipment it belongs to names a matter.
  | "shipping-label"
  // The frozen list of review documents one bulk coding act executed against, resolved once at
  // initiation. It is a list of handles and nothing else — no content, no names — and it belongs to
  // the one matter its review set does. A RECORD rather than a cache: "which documents did that act
  // touch" is asked when a production drawn from that coding is challenged, so it outlives the
  // derived artifacts a closing review set releases.
  | "review-coding-selection"
  // One immutable Tantivy split of the discovery keyword index — a self-contained segment bundle plus
  // its footer, range-read by the search engine and never mutated. A DERIVED cache: it is rebuildable
  // from the documents it was built from, which is what makes it safe to expire, and the class is what
  // tells a reader of the bucket that these bytes are an index rather than a document. A split belongs
  // to exactly one corpus, and a corpus is a matter today, so it stamps that matter.
  | "search-split"
  // The text a discovery review document extracted to, and the per-document metadata sidecar beside
  // it. Both are DERIVED caches — rebuildable by re-processing the source bytes, which is what makes
  // them collectable when a review set closes — and both belong to the one matter the review set is
  // on. They are stamped apart from a working document deliberately: these bytes are a reading of
  // material an opposing party produced, and a bucket-wide filter has to be able to exclude them
  // without knowing a key layout.
  | "review-extracted-text"
  | "review-document-metadata"
  // A discovery load's manifest or its exception report, in either the machine-readable or the
  // printable form. Stamped apart from the two above because it is the OPPOSITE kind of object: those
  // are derived caches a review set releases when it closes, and these are RECORDS — what a party
  // handed over, and which of it could not be read — that survive the review set and are never
  // regenerated. A collection rule that could not tell the two apart would delete the evidence and
  // keep the cache.
  | "review-load-record";

// Classes for objects the firm owns that belong to no single matter. Stamping the class on these is
// what makes "this object has no matter" a recorded fact rather than an absence indistinguishable from
// a write path that forgot.
export type FirmScopedObjectClass =
  // A built bulk-download archive. Its selection may span matters, so it belongs to none of them.
  | "download-bundle"
  // The source or the result of a format conversion run from the firm-level converter tool.
  | "conversion-artifact"
  // A document template version, or its staged upload.
  | "document-template"
  // A location's letterhead image.
  | "letterhead-image"
  // The verbatim bytes of a captured email, keyed by their own hash. One object can be the original
  // behind filings on several matters, so it can carry no single matter and must not pretend to.
  | "email-original"
  // Inbound mail parked before it has been parsed and routed. It has no matter yet, and may never
  // acquire one.
  | "email-staging"
  // A label for a shipment that names no matter.
  | "shipping-label"
  // A tabular export on a member's shelf: the stored DOCUMENT a later download renders into a
  // format. Its figures may span matters and the shelf is the member's, so it belongs to none.
  | "export-snapshot";

// Classes a reader of these objects may encounter one day and which NOTHING in this platform writes
// today. They are named here so the vocabulary is closed rather than open-ended, and so a filter that
// excludes them can be written before the first such object exists.
export type ReservedObjectClass = "work-product" | "transcript" | "received-material";

export type ObjectClass = MatterScopedObjectClass | FirmScopedObjectClass | ReservedObjectClass;

export const MATTER_SCOPED_OBJECT_CLASSES: readonly MatterScopedObjectClass[] = [
  "working-document",
  "working-copy",
  "export-copy",
  "shipping-label",
  "review-coding-selection",
  "search-split",
  "review-extracted-text",
  "review-document-metadata",
  "review-load-record",
];

export const FIRM_SCOPED_OBJECT_CLASSES: readonly FirmScopedObjectClass[] = [
  "download-bundle",
  "conversion-artifact",
  "document-template",
  "letterhead-image",
  "email-original",
  "email-staging",
  "shipping-label",
  "export-snapshot",
];

export const RESERVED_OBJECT_CLASSES: readonly ReservedObjectClass[] = [
  "work-product",
  "transcript",
  "received-material",
];

// The stamped pairs, in the shape both the Workers binding and the header builder take.
export type ObjectDimensions = Readonly<Record<string, string>>;

// A stamped value is a handle or a vocabulary token — never content. The cap is generous enough that
// no legitimate value approaches it and tight enough that a stray body cannot be smuggled into object
// metadata, and it stays inside what a downstream retrieval index preserves without truncating.
export const MAXIMUM_DIMENSION_VALUE_LENGTH = 500;

// Thrown when a caller tries to stamp something that is not a handle. Every value reaching this module
// is server-derived, so a violation is a defect in the calling code rather than a user's mistake —
// which is exactly the case a throw is for.
export class ObjectDimensionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjectDimensionError";
  }
}

// A value has to survive the trip as an HTTP header on the S3 write path, so it is restricted to
// printable ASCII: a newline would split the header and a non-ASCII byte would be re-encoded
// differently by different clients, which for a scope dimension means two objects that disagree about
// the same matter.
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

function requireStampableValue(name: string, value: string): string {
  if (value.length === 0) {
    throw new ObjectDimensionError(`the ${name} dimension cannot be stamped as an empty value`);
  }
  if (value.length > MAXIMUM_DIMENSION_VALUE_LENGTH) {
    throw new ObjectDimensionError(
      `the ${name} dimension is ${value.length} characters, over the ${MAXIMUM_DIMENSION_VALUE_LENGTH}-character limit`,
    );
  }
  if (!PRINTABLE_ASCII.test(value)) {
    throw new ObjectDimensionError(
      `the ${name} dimension carries a character that cannot travel as a request header`,
    );
  }
  return value;
}

export interface MatterScopedObjectInput {
  readonly objectClass: MatterScopedObjectClass;
  readonly matterId: MatterId;
}

// The stamp for an object that belongs to one matter. The two arguments are required together on
// purpose: a matter-scoped class with no matter is the exact mistake this module exists to prevent, so
// it is not expressible rather than merely discouraged.
export function matterScopedObjectDimensions(input: MatterScopedObjectInput): ObjectDimensions {
  return {
    [MATTER_DIMENSION]: requireStampableValue(MATTER_DIMENSION, input.matterId),
    [OBJECT_CLASS_DIMENSION]: requireStampableValue(OBJECT_CLASS_DIMENSION, input.objectClass),
  };
}

// The stamp for an object the firm owns that belongs to no matter. It carries the class alone — which
// is the point: an object with a class and no matter says "no matter applies here", where an object
// with neither says only "nobody stamped this".
export function firmScopedObjectDimensions(objectClass: FirmScopedObjectClass): ObjectDimensions {
  return { [OBJECT_CLASS_DIMENSION]: requireStampableValue(OBJECT_CLASS_DIMENSION, objectClass) };
}

// The same pairs as S3 request headers, for the presigned PUT and the server-side multipart create.
// Header names are lower-cased because that is the form the signature covers; a client sending a
// different case would still match (headers are case-insensitive) but the signed canonical form is not.
export function objectDimensionHeaders(dimensions: ObjectDimensions): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(dimensions)) {
    headers[`x-amz-meta-${name.toLowerCase()}`] = requireStampableValue(name, value);
  }
  return headers;
}

// The inverse, for a write path that receives an object's headers rather than its metadata record —
// the development upload emulation, which stands in for R2's own header handling.
export function objectDimensionsFromHeaders(headers: Headers): ObjectDimensions {
  const dimensions: Record<string, string> = {};
  headers.forEach((value, name) => {
    const lowered = name.toLowerCase();
    if (!lowered.startsWith("x-amz-meta-")) return;
    dimensions[lowered.slice("x-amz-meta-".length)] = value;
  });
  return dimensions;
}

// The matter an object declares it belongs to, or null when it declares none. Null is the honest answer
// for both a firm-level object and an object written before the stamp existed; the two are told apart
// by the class, which a firm-level object carries and an unstamped one does not.
export function matterOfObject(
  customMetadata: Record<string, string> | undefined,
): MatterId | null {
  const value = customMetadata?.[MATTER_DIMENSION];
  return value === undefined || value === "" ? null : (value as MatterId);
}

export function objectClassOf(
  customMetadata: Record<string, string> | undefined,
): ObjectClass | null {
  const value = customMetadata?.[OBJECT_CLASS_DIMENSION];
  return value === undefined || value === "" ? null : (value as ObjectClass);
}

// Whether an object carries the full stamp. The backfill sweep's candidate test: an object that fails
// it is one no reader can scope, and the sweep exists to make that set empty.
export function objectIsStamped(customMetadata: Record<string, string> | undefined): boolean {
  return objectClassOf(customMetadata) !== null;
}
