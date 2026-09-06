import {
  matterScopedObjectDimensions,
  objectIsStamped,
  OBJECT_CLASS_DIMENSION,
  type MatterScopedObjectClass,
  type ObjectDimensions,
} from "@magna-carta/object-dimensions/dimensions";
import type { MatterId } from "@magna-carta/identifiers/types";

// Copying an object inside a firm's bucket — cutting a version out of a live working copy, promoting a
// returned offline edit — and keeping its scope with it.
//
// THE SOURCE IS THE AUTHORITY ON THE MATTER, not the database. Both bytes are the same document, so the
// copy belongs to whatever matter the source belongs to; re-reading the matter from the database here
// would add a query that can disagree with the object it is stamping, and a disagreement between an
// object and its own copy is exactly the failure this dimension exists to make impossible. What DOES
// change is the class: a working copy promoted into a version stops being a working copy.
//
// An unstamped source (written before any of this existed) produces an unstamped copy rather than a
// guessed one. The repair pass in dimension-backfill-sweep.ts converges both.
export async function copyObjectPreservingDimensions(
  bucket: R2Bucket,
  fromKey: string,
  toKey: string,
  targetObjectClass: MatterScopedObjectClass,
): Promise<void> {
  const source = await bucket.get(fromKey);
  if (source === null) return;
  const carried = source.customMetadata;
  const dimensions = objectIsStamped(carried)
    ? { ...carried, [OBJECT_CLASS_DIMENSION]: targetObjectClass }
    : carried;
  await bucket.put(toKey, source.body, {
    httpMetadata: source.httpMetadata,
    customMetadata: dimensions,
  });
}

// Copying a committed version's bytes into a NEW file on a matter of the caller's choosing — the
// upload dialog's "the firm already holds these bytes" path. Unlike the copy above, the target's
// matter is the CALLER's authority: the new file may sit on another matter than the source, so the
// stamp is written fresh from the destination rather than carried from the source. Nothing else is
// invented — the content type travels with the bytes.
export async function copyObjectIntoMatter(
  bucket: R2Bucket,
  fromKey: string,
  toKey: string,
  dimensions: ObjectDimensions,
): Promise<void> {
  const source = await bucket.get(fromKey);
  if (source === null) {
    throw new Error(`object to duplicate is missing from the bucket: ${fromKey}`);
  }
  await bucket.put(toKey, source.body, {
    httpMetadata: source.httpMetadata,
    customMetadata: dimensions,
  });
}

// The stamp for the single mutable working copy of a document. Its own function because the class is
// the one thing standing between "the version the firm committed" and "what somebody has typed since",
// and nothing but the editing path may write it.
export function workingCopyDimensions(matterId: MatterId) {
  return matterScopedObjectDimensions({ objectClass: "working-copy", matterId });
}
