import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { loadCommittedVersionByR2Key } from "@magna-carta/file-manager/queries";
import { readScanEngineVersion } from "@magna-carta/file-manager/upload-policy";

// The access-triggered re-scan: when a file is ACCESSED (download / preview), enqueue a BACKGROUND
// re-scan of the served version IF its recorded scan engine version is stale relative to the firm's
// current engine. Designed to run under `executionCtx.waitUntil`, so it NEVER blocks the response — the
// file serves immediately under its last-known verdict, and the ingest consumer's re-scan branch
// (cache-first) updates the verdict in the background; a fresh flagged finding then gates the next
// access (informed access). Cost tracks attention, not corpus size: a file nobody opens is never
// re-scanned, and the same file under the same engine is a cheap no-op here (already current).
//
// No-op (never enqueues) when: the queue is unbound; no current engine version is recorded (never
// re-scan against an unknown engine — the staleness comparison would be meaningless and could enqueue
// against a fabricated key); or the version is already current. The enqueued message is the same
// R2-event shape the ingest consumer reads — it finds no pending version and runs the in-place re-scan.
export async function maybeEnqueueRescanOnAccess(
  queue: Queue | undefined,
  firmDatabase: SqlDatabase,
  bucketName: string | null,
  r2Key: string,
  sizeBytes: number | null,
): Promise<void> {
  if (queue === undefined || bucketName === null) return; // unbound queue or unrecorded bucket → no-op
  const committed = await loadCommittedVersionByR2Key(firmDatabase, r2Key);
  if (committed === undefined) return;
  const current = await readScanEngineVersion(firmDatabase);
  if (current === null) return; // no current engine recorded — nothing to compare against
  if (committed.scanEngineVersion === current) return; // already scanned under the current engine
  await queue.send({
    bucket: bucketName,
    object: { key: r2Key, size: sizeBytes ?? 0 },
    action: "AccessRescan",
  });
}
