import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { FileVersionId } from "@magna-carta/identifiers/types";
import { matterScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import {
  playableCopyKey,
  playableCopySourceFormat,
  type PlayableCopyUnavailableReason,
  readVersionForPlayableCopy,
  recordVersionPlayableCopyStatement,
  type RecordPlayableCopyRow,
} from "@magna-carta/file-manager/playable-copy";
import type { Bindings } from "../../bindings.ts";
import type { PlayableCopyMessage } from "../../conversions/conversion-types.ts";
import { resolveFirmBucket } from "../../files/firm-bucket.ts";
import {
  firmDatabaseFor,
  type ProxyBatchDatabase,
} from "../../firm-database/firm-database-proxy.ts";

// Making a video version's playable copy (packages/file-manager/src/playable-copy.ts), off the
// request path, on the conversion queue.
//
// THE BYTES NEVER BUFFER HERE. A recording is gigabytes and this isolate has 128 MB, so the original
// streams from the firm's bucket straight into the convert worker's transcode engine, and the engine's
// answer streams straight back into the bucket. The engine spools to its own disk and answers with a
// Content-Length, which is what lets the copy be written as one length-bound put: an R2 put of a
// stream with no known length stores nothing.
//
// The engine's answer is recorded whatever it is. A refusal (a codec it does not decode, a damaged
// file, a file past its ceilings) is `unavailable` with the engine's reason, so the player stops
// offering a conversion that will only fail again. A fault (the engine not answering, a 5xx) throws,
// and the queue retries; a version left `pending` by retries that all failed can be asked for again
// once the request is stale.

/** The engine and recipe the copy is made with. One home: the request route names neither. */
export const PLAYABLE_COPY_ENGINE_ID = "transcode";
export const PLAYABLE_COPY_TARGET_FORMAT = "playable-mp4";
export const PLAYABLE_COPY_RECIPE = "mp4-h264-aac-faststart";

export type PlayableCopyOutcome =
  | { readonly kind: "ready"; readonly r2Key: string; readonly sizeBytes: number }
  | { readonly kind: "unavailable"; readonly reason: PlayableCopyUnavailableReason }
  // Nothing to do: the version is gone, no longer clean, already has its copy, or was never asked about.
  | { readonly kind: "skipped" }
  // The deployment has no convert worker bound: left pending, so it can be asked for again later.
  | { readonly kind: "no-engine" };

/** The engine's refusals, by the status its HTTP surface answers them with. */
function refusalReason(status: number): PlayableCopyUnavailableReason | null {
  switch (status) {
    case 413:
      return "too-large";
    case 415:
      return "unsupported";
    case 422:
      return "malformed";
    default:
      return null;
  }
}

export async function producePlayableCopy(
  env: Bindings,
  database: ProxyBatchDatabase,
  message: PlayableCopyMessage,
  now: () => string,
): Promise<PlayableCopyOutcome> {
  const version = await readVersionForPlayableCopy(database, message.versionId as FileVersionId);
  if (version === undefined || version.playableCopyState !== "pending") return { kind: "skipped" };
  // Flagged after it was asked for: the engine is not handed it. Left pending, it can be asked for
  // again only if a later scan clears it, because the request route refuses a flagged version.
  if (version.scanVerdict === "flagged") return { kind: "skipped" };
  const sourceFormat = playableCopySourceFormat(version.sniffedContentType);
  if (sourceFormat === null) {
    return record(database, now, {
      versionId: version.id,
      state: "unavailable",
      reason: "unsupported",
    });
  }
  const convert = env.CONVERT;
  if (convert === undefined) return { kind: "no-engine" };

  const { bucket } = resolveFirmBucket(env, message.bucketName);
  const source = await bucket.get(version.r2Key);
  if (source === null) {
    return record(database, now, {
      versionId: version.id,
      state: "unavailable",
      reason: "source-missing",
    });
  }

  const response = await convert.fetch(
    new Request("https://convert/convert", {
      method: "POST",
      headers: {
        "x-engine-id": PLAYABLE_COPY_ENGINE_ID,
        "x-source-format": sourceFormat,
        "x-target-format": PLAYABLE_COPY_TARGET_FORMAT,
        "x-recipe": PLAYABLE_COPY_RECIPE,
        "content-length": String(source.size),
      },
      body: source.body,
    }),
  );
  if (!response.ok) {
    await response.body?.cancel();
    const reason = refusalReason(response.status);
    if (reason === null) throw new Error(`transcode engine answered ${response.status}`);
    return record(database, now, { versionId: version.id, state: "unavailable", reason });
  }
  const length = Number(response.headers.get("content-length"));
  if (response.body === null || !Number.isSafeInteger(length) || length <= 0) {
    await response.body?.cancel();
    throw new Error("transcode engine answered without a length");
  }

  const r2Key = playableCopyKey(version.r2Key);
  const sized = new FixedLengthStream(length);
  const [, stored] = await Promise.all([
    response.body.pipeTo(sized.writable),
    bucket.put(r2Key, sized.readable, {
      httpMetadata: { contentType: "video/mp4" },
      customMetadata: matterScopedObjectDimensions({
        objectClass: "playable-copy",
        matterId: version.matterId,
      }),
    }),
  ]);
  return record(database, now, {
    versionId: version.id,
    state: "ready",
    r2Key,
    sizeBytes: stored?.size ?? length,
  });
}

async function record(
  database: ProxyBatchDatabase,
  now: () => string,
  row: RecordPlayableCopyRow,
): Promise<PlayableCopyOutcome> {
  await commitEffectBatch(
    database,
    { statements: [recordVersionPlayableCopyStatement(database, row)], outboxMessages: [] },
    { now },
  );
  return row.state === "ready"
    ? { kind: "ready", r2Key: row.r2Key, sizeBytes: row.sizeBytes }
    : { kind: "unavailable", reason: row.reason };
}

/** One queue message: resolve the firm's database, make the copy. A throw is the queue's retry. */
export async function handlePlayableCopyMessage(
  env: Bindings,
  message: PlayableCopyMessage,
): Promise<PlayableCopyOutcome> {
  return producePlayableCopy(env, firmDatabaseFor(env.FIRM_DATABASE, message.firmId), message, () =>
    new Date().toISOString(),
  );
}
