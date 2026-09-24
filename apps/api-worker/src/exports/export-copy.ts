import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  acceptTrackedChanges,
  WORKING_DOCUMENT_PACKAGE_LIMITS,
} from "@magna-carta/document-assembly/ooxml-accept-tracked-changes";
import {
  exportCopyKey,
  needsExportCopy,
  recordVersionExportCopyStatement,
  type VersionForExportCopy,
} from "@magna-carta/file-manager/export-copy";
import { matterScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import type { ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";

// Producing a version's export copy: the document with every tracked change accepted, written
// beside the version and recorded on its row.
//
// The stored version is never touched. A word-processing version the editor cut carries its marks
// for as long as it lives, and this is the one place a copy without them is made — once per
// version, from the version's own bytes, so every path that hands a copy out (the download, the
// bundle) reads the same object rather than each accepting the changes for itself. Which paths
// those are, and why every one of them must go through ../exports/export-object.ts, is written up
// in ../editing/CLAUDE.md (_Every copy that leaves the platform_).
//
// The outcome is recorded whatever it is. A document the accept pass cannot hold is recorded as
// `unavailable` rather than left `pending`: a pending copy is one the download path will try to
// make on the spot, and trying the same oversize document on every download is the wrong kind of
// patience. A version that recorded nothing is `ready` at its own key — the copy IS the version,
// and a second object holding the same bytes would be storage spent on nothing.

export type ExportCopyOutcome =
  // The copy exists, at this key.
  | { readonly kind: "ready"; readonly r2Key: string; readonly sizeBytes: number }
  // No copy can be made for this version; a copy that leaves is served from the version's bytes.
  | { readonly kind: "unavailable"; readonly reason: ExportCopyUnavailableReason }
  // The version is not one that carries a copy (an upload, another format), so nothing was done.
  | { readonly kind: "not-needed" };

export type ExportCopyUnavailableReason =
  | "oversize"
  | "part-too-large"
  | "decompression-bomb"
  | "not-a-package"
  | "not-a-word-package"
  | "source-missing";

export async function produceExportCopy(
  database: ProxyBatchDatabase,
  bucket: R2Bucket,
  version: VersionForExportCopy,
  now: () => string,
): Promise<ExportCopyOutcome> {
  if (version.exportCopyState === "ready" && version.exportR2Key !== null) {
    return {
      kind: "ready",
      r2Key: version.exportR2Key,
      sizeBytes: version.exportSizeBytes ?? version.sizeBytes ?? 0,
    };
  }
  if (!needsExportCopy(version.name, version.saveKind)) {
    // A row marked pending for a document that turned out not to need a copy (the file was renamed
    // out of the format) is settled here, so the download path stops asking.
    if (version.exportCopyState === "pending") {
      await record(database, version, { state: "unavailable", r2Key: null, sizeBytes: null }, now);
    }
    return { kind: "not-needed" };
  }

  const source = await bucket.get(version.r2Key);
  if (source === null) {
    await record(database, version, { state: "unavailable", r2Key: null, sizeBytes: null }, now);
    return { kind: "unavailable", reason: "source-missing" };
  }
  // Decided from the object's size before its bytes are held, so an oversize document costs a HEAD
  // and a row write rather than an allocation the isolate cannot make.
  if (source.size > WORKING_DOCUMENT_PACKAGE_LIMITS.maxPackageBytes) {
    await record(database, version, { state: "unavailable", r2Key: null, sizeBytes: null }, now);
    return { kind: "unavailable", reason: "oversize" };
  }

  const bytes = new Uint8Array(await source.arrayBuffer());
  const accepted = acceptTrackedChanges(bytes);
  if (!accepted.ok) {
    await record(database, version, { state: "unavailable", r2Key: null, sizeBytes: null }, now);
    return { kind: "unavailable", reason: accepted.reason };
  }

  if (accepted.value.acceptedMarks === 0) {
    const sizeBytes = source.size;
    await record(database, version, { state: "ready", r2Key: version.r2Key, sizeBytes }, now);
    return { kind: "ready", r2Key: version.r2Key, sizeBytes };
  }

  const r2Key = exportCopyKey(version.fileId, version.id);
  const sizeBytes = accepted.value.bytes.byteLength;
  await bucket.put(r2Key, accepted.value.bytes, {
    httpMetadata: source.httpMetadata,
    customMetadata: matterScopedObjectDimensions({
      objectClass: "export-copy",
      matterId: version.matterId,
    }),
  });
  await record(database, version, { state: "ready", r2Key, sizeBytes }, now);
  return { kind: "ready", r2Key, sizeBytes };
}

async function record(
  database: ProxyBatchDatabase,
  version: VersionForExportCopy,
  copy: {
    readonly state: "ready" | "unavailable";
    readonly r2Key: string | null;
    readonly sizeBytes: number | null;
  },
  now: () => string,
): Promise<void> {
  await commitEffectBatch(
    database,
    {
      statements: [
        recordVersionExportCopyStatement(database, {
          versionId: version.id,
          state: copy.state,
          exportR2Key: copy.r2Key,
          exportSizeBytes: copy.sizeBytes,
        }),
      ],
      outboxMessages: [],
    },
    { now },
  );
}
