// A version cut from the live working copy, on the member's own save.
//
// The editor saves into `current`, the one mutable working object per file, and a version is what
// the platform's history shows. Until now a version was cut only when a session ended, which in
// practice was the idle reap half an hour after the last editor left: a member pressed Save, saw
// it land, opened the file's history and found nothing. Every save with changed bytes is a version
// now, the editor's autosave included: the owner's ruling is that a timeline of every state is the
// point, and that too many rows is a folding problem for history, never a reason to keep less. The
// kind of save rides on the version so history can fold the autosaves and name the rest, and the
// session's participants ride with it so history can say who was there.
//
// commitEditedVersion already refuses to cut a version whose bytes match the latest, so a save
// with nothing changed is a no-op here as everywhere. The idle-reap alarm keeps its own copy of
// this sequence because it also frees the document in the same batch.
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { commitEditedVersion } from "@magna-carta/file-manager/file-service";
import { currentObjectKey } from "@magna-carta/file-manager/file-statements";
import type { VersionSaveKind } from "@magna-carta/file-manager/file-statements";
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
  saveKind: VersionSaveKind,
  participants: readonly UserId[],
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
      saveKind,
      participants,
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
