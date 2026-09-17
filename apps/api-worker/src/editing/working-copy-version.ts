// A version cut from the live working copy, on the member's own save.
//
// The editor saves into `current`, the one mutable working object per file, and a version is what
// the platform's history shows. Until now a version was cut only when a session ended, which in
// practice was the idle reap half an hour after the last editor left: a member pressed Save, saw
// it land, opened the file's history and found nothing. The editor says on every save what kind
// of save it was, and the kinds mean different things here: a save the member asked for, and the
// save the editor makes as the last view leaves, are moments the member would name; the autosave
// every few minutes is not, and a version per autosave would bury the ones that were.
//
// commitEditedVersion already refuses to cut a version whose bytes match the latest, so a Save
// with nothing changed is a no-op here as everywhere. The idle-reap alarm keeps its own copy of
// this sequence because it also frees the document in the same batch.
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { commitEditedVersion } from "@magna-carta/file-manager/file-service";
import { currentObjectKey } from "@magna-carta/file-manager/file-statements";
import type { FileId, FileVersionId, UserId } from "@magna-carta/identifiers/types";
import { copyObjectPreservingDimensions } from "../files/object-stamping.ts";
import type { ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import type { CurrentObjectMeta } from "./document-session.ts";

export async function cutVersionFromWorkingCopy(
  database: ProxyBatchDatabase,
  bucket: R2Bucket,
  fileId: FileId,
  meta: CurrentObjectMeta,
  author: UserId,
  now: () => string,
): Promise<{ readonly versionId: FileVersionId | null }> {
  const committed = await commitEditedVersion(
    database,
    {
      fileId,
      currentR2Key: currentObjectKey(fileId),
      contentSha256: meta.sha256,
      sizeBytes: meta.sizeBytes,
      uploadedBy: author,
    },
    { clock: { now }, actorUserId: author },
    async (fromKey, toKey) => {
      await copyObjectPreservingDimensions(bucket, fromKey, toKey, "working-document");
    },
  );
  if (committed.skipped) return { versionId: null };
  await commitEffectBatch(database, committed.effect, { now });
  return { versionId: committed.versionId };
}
