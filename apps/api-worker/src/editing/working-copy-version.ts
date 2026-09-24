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
//
// A word-processing version the editor cut owes an EXPORT COPY — the same document with every
// tracked change accepted, which is what a download of it is served from — and the cut marks it
// as owing one in the same batch, so no moment exists in which the version is current and a
// download of it could be served from the stored marks. Making the copy is the queue's
// (../exports/export-copy-consumer.ts); the caller asks for it once the batch has committed.
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  markVersionExportCopyPendingStatement,
  needsExportCopy,
} from "@magna-carta/file-manager/export-copy";
import { commitEditedVersion } from "@magna-carta/file-manager/file-service";
import { currentObjectKey, selectFileStatement } from "@magna-carta/file-manager/file-statements";
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
): Promise<{ readonly versionId: FileVersionId | null; readonly owesExportCopy: boolean }> {
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
  if (committed.skipped) return { versionId: null, owesExportCopy: false };
  const { results } = await selectFileStatement(database, fileId).all<{ name: string }>();
  const owesExportCopy = needsExportCopy(results[0]?.name ?? "", saveKind);
  await commitEffectBatch(
    database,
    owesExportCopy
      ? {
          ...committed.effect,
          statements: [
            ...committed.effect.statements,
            markVersionExportCopyPendingStatement(database, committed.versionId),
          ],
        }
      : committed.effect,
    { now },
  );
  return { versionId: committed.versionId, owesExportCopy };
}
