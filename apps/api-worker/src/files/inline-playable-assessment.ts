import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { recordInlinePlayableStatement } from "@magna-carta/file-manager/file-statements";
import {
  assessInlinePlayable,
  isPlayabilityCandidate,
  type ByteRangeReader,
} from "@magna-carta/file-manager/inline-playable";
import {
  getCurrentCleanVersionForPreview,
  type CleanVersionForPreview,
} from "@magna-carta/file-manager/queries";
import type { FileId } from "@magna-carta/identifiers/types";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../bindings.ts";
import { resolveFirmBucket } from "./firm-bucket.ts";

// The inline-playability verdict is computed by its first reader, not at upload. The ingest pipeline
// reads an object exactly once and its head window is four kilobytes, which cannot reach a track table
// that a recorder left at the end of a two-gigabyte file; and computing it here also answers for
// every video uploaded before the verdict existed, with no backfill. The cost is paid once per
// version: the verdict is written back and every later preview reads the column.
//
// A failure to read is not a verdict. The version keeps its absent verdict, this request degrades to
// the download the preview gate already offers for an absent one, and the next reader tries again.

/** Is this version worth assessing at all: never judged, a video container, and servable inline. */
function needsAssessment(version: CleanVersionForPreview): boolean {
  return (
    version.inlinePlayable === null &&
    isPlayabilityCandidate(version.sniffedContentType) &&
    version.scanVerdict !== "flagged" &&
    version.storageClass === "standard" &&
    version.storageEncoding === "full" &&
    version.artifactRole !== "derived" &&
    version.sizeBytes !== null
  );
}

function rangeReader(bucket: R2Bucket, key: string, size: number): ByteRangeReader {
  return {
    size,
    async read(offset, length) {
      const bounded = Math.max(0, Math.min(length, size - offset));
      if (bounded === 0) return new Uint8Array(0);
      const object = await bucket.get(key, { range: { offset, length: bounded } });
      if (object === null) throw new Error("the version's object is not readable");
      return new Uint8Array(await object.arrayBuffer());
    },
  };
}

export async function withInlinePlayableVerdict(
  env: Bindings,
  firmDatabase: SqlDatabase,
  firmBucketName: string | null,
  version: CleanVersionForPreview,
): Promise<CleanVersionForPreview> {
  if (!needsAssessment(version) || version.sizeBytes === null) return version;
  try {
    const { bucket } = resolveFirmBucket(env, firmBucketName);
    const verdict = await assessInlinePlayable(
      version.sniffedContentType,
      rangeReader(bucket, version.r2Key, version.sizeBytes),
    );
    await recordInlinePlayableStatement(firmDatabase, version.id, verdict).run();
    return { ...version, inlinePlayable: verdict };
  } catch (error) {
    logOperationFailed(
      createWorkersLogger(env.TELEMETRY),
      "files.inline-playable-assessment",
      error,
    );
    return version;
  }
}

/**
 * The current clean version a preview is granted over, with its inline-playability verdict
 * settled: read from the column when a reader before this one judged it, judged now otherwise.
 */
export async function readPreviewVersion(
  env: Bindings,
  firm: { readonly firmDatabase: SqlDatabase; readonly bucketName: string | null },
  fileId: FileId,
): Promise<CleanVersionForPreview | undefined> {
  const stored = await getCurrentCleanVersionForPreview(firm.firmDatabase, fileId);
  if (stored === undefined) return undefined;
  return withInlinePlayableVerdict(env, firm.firmDatabase, firm.bucketName, stored);
}
