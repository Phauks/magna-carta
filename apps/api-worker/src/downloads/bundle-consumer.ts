import { zipEntriesFromR2 } from "@magna-carta/file-manager/zip-entries-from-r2";
import { firmScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import { makeZip } from "client-zip";
import type { Bindings } from "../bindings.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import { bundleContainerAdapter } from "./bundle-container-adapter.ts";
import type { BundleBuildMessage } from "./bundle-types.ts";

// The bundle-build queue consumer: for each message, stream the selection's R2 object bodies through
// client-zip into a single R2 object at bundles/<manifestHash>.zip (the firm's own bucket), then mark
// the coordinator ready. Nothing buffers the whole archive — R2 bodies flow into the zip stream and
// out through a multipart upload as fixed-size parts. A throw marks the job failed and rethrows so the
// queue retries the message (and dead-letters after max attempts); a build that never reports back is
// failed by the coordinator's stuck alarm instead.

// R2's multipart minimum: every part except the last must be at least 5 MiB. A single streamed put
// can't be used — client-zip produces a stream of unknown total length, which R2.put rejects (no
// content-length) — so the archive is uploaded as uniform 5 MiB parts with a smaller final part.
const PART_SIZE = 5 * 1024 * 1024;

function concatChunks(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
  if (chunks.length === 1) return chunks[0] as Uint8Array;
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

// Streams a ReadableStream into an R2 object via a multipart upload, cutting uniform 5 MiB parts so no
// part but the last is undersized and the whole archive never lives in memory at once. Aborts the
// upload on any failure so a wedged build leaves no dangling multipart state.
async function putStreamMultipart(
  bucket: R2Bucket,
  key: string,
  stream: ReadableStream<Uint8Array>,
): Promise<void> {
  // A bundle's selection may span matters, so it belongs to none of them and carries its class alone.
  // Stamped at create, because a multipart object's metadata is fixed there and nowhere else.
  const upload = await bucket.createMultipartUpload(key, {
    customMetadata: firmScopedObjectDimensions("download-bundle"),
  });
  try {
    const parts: R2UploadedPart[] = [];
    const reader = stream.getReader();
    let pending: Uint8Array[] = [];
    let pendingBytes = 0;
    const uploadPart = async (bytes: Uint8Array) => {
      parts.push(await upload.uploadPart(parts.length + 1, bytes));
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;
      pending.push(value);
      pendingBytes += value.byteLength;
      while (pendingBytes >= PART_SIZE) {
        const merged = concatChunks(pending, pendingBytes);
        await uploadPart(merged.subarray(0, PART_SIZE));
        const rest = merged.subarray(PART_SIZE);
        pending = rest.byteLength > 0 ? [rest] : [];
        pendingBytes = rest.byteLength;
      }
    }
    // The final part carries the remainder (any size). Upload it, or — only if nothing was ever
    // buffered — an empty part, so the upload always completes with at least one part.
    if (pendingBytes > 0 || parts.length === 0) {
      await uploadPart(concatChunks(pending, pendingBytes));
    }
    await upload.complete(parts);
  } catch (error) {
    // Best-effort abort: a throwing abort (a transient R2 error — common precisely when the upload was
    // already failing) must not replace the original error, which carries the real cause to markFailed.
    // Dangling parts from a failed abort are reclaimed by R2's abort-incomplete-multipart lifecycle.
    try {
      await upload.abort();
    } catch {
      // swallow — propagate the original error below
    }
    throw error;
  }
}

async function buildOne(env: Bindings, message: BundleBuildMessage): Promise<void> {
  // Reads and writes both go through the handle resolved from message.bucketName, which is the same
  // seam (files/firm-bucket.ts) the download and bundle-status routes presign against — so the inputs
  // read, the artifact written, and the URL later signed all name one bucket. Resolving the pair here
  // rather than reaching for the binding is what keeps this consumer correct once a firm resolves to
  // its own bucket rather than the bound one.
  const { bucket } = resolveFirmBucket(env, message.bucketName);
  const coordinator = env.BUNDLE_COORDINATOR.get(
    env.BUNDLE_COORDINATOR.idFromName(`${message.firmId}:${message.manifestHash}`),
  );
  try {
    if (message.manifest !== undefined) {
      // The optioned lane (compression / 7z / split): the container owns the build and the R2 writes
      // (it reaches R2 through the bundle worker's outbound handler), so this consumer only hands it
      // the prebuilt manifest and records the volume keys it reports back. Nothing streams through the
      // Worker here — the artifact never touches this isolate.
      const service = env.BUNDLE_SERVICE;
      if (service === undefined) {
        // No bound bundle worker (a deployment without the service binding): a retryable failure, so
        // the build is not silently dropped — it re-queues until the binding is present.
        throw new Error("bundle service binding is not configured");
      }
      const volumes = await bundleContainerAdapter(service).build(message.manifest);
      await coordinator.markReadyVolumes(volumes);
      return;
    }

    // The plain client-zip lane: stream each entry's R2 object body through client-zip into a single
    // R2 object, then mark ready with that one artifact key. zipEntriesFromR2 fetches and skips reaped
    // objects (shared with the inline download path in routes/downloads.ts).
    const key = `bundles/${message.manifestHash}.zip`;
    await putStreamMultipart(bucket, key, makeZip(zipEntriesFromR2(bucket, message.entries)));
    await coordinator.markReady(key);
  } catch (error) {
    // markFailed only transitions a still-`building` job (the coordinator guards it), so a transient
    // failure here briefly shows `failed` but self-heals: the rethrow retries the queue message, and a
    // later success calls markReady/markReadyVolumes. A zombie attempt's markFailed can never clobber
    // that ready.
    await coordinator.markFailed(error instanceof Error ? error.message : "build failed");
    throw error;
  }
}

export async function bundleBuildQueue(
  batch: MessageBatch<BundleBuildMessage>,
  env: Bindings,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await buildOne(env, message.body);
      message.ack();
    } catch {
      message.retry();
    }
  }
}
