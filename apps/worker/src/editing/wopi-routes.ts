// The WOPI file-access handlers Collabora calls during an editing session. They run AFTER the guard
// has verified the token and resolved the firm database, so they trust the claims for tenancy and
// derive every object key from the token's fileId/versionId — never from the request line. Capability
// is the write gate: UserCanWrite is only a UI hint, so it mirrors the token's capability and the
// mutating handlers (PutFile, Lock) enforce `edit` server-side separately.

import {
  currentObjectKey,
  fileVersionKey,
  selectFileStatement,
} from "@magna-carta/file-manager/file-statements";
import { getCurrentCleanVersion } from "@magna-carta/file-manager/queries";
import type { FileId, FileVersionId } from "@magna-carta/identifiers/types";
import type { CurrentObjectMeta } from "./document-session.ts";
import type { EditTokenClaims } from "./wopi-token.ts";

export class WopiRouteError extends Error {
  readonly code: "not-found";
  constructor(code: "not-found", message?: string) {
    super(message ?? code);
    this.name = "WopiRouteError";
    this.code = code;
  }
}

// The bindings + live-session state a file-access handler reads from. `currentMeta` is the working-copy
// metadata the session Durable Object recorded on the last PutFile (null when no live session has
// written `current` yet); it makes the live size/timestamp authoritative over the committed version's.
export interface WopiFileDeps {
  readonly database: D1Database;
  readonly bucket: R2Bucket;
  readonly currentMeta: CurrentObjectMeta | null;
}

// The CheckFileInfo response. WOPI requires BaseFileName, OwnerId, Size, UserId and Version; the rest
// are the capability + modification hints Collabora reads. The host is authoritative for write access,
// so UserCanWrite reflects the token capability rather than any client-supplied flag.
export interface CheckFileInfoBody {
  readonly BaseFileName: string;
  readonly Size: number;
  readonly Version: string;
  readonly OwnerId: string;
  readonly UserId: string;
  readonly UserCanWrite: boolean;
  readonly LastModifiedTime: string | null;
}

export async function checkFileInfo(
  claims: EditTokenClaims,
  deps: WopiFileDeps,
): Promise<CheckFileInfoBody> {
  const fileId = claims.fileId as FileId;
  const { results } = await selectFileStatement(deps.database, fileId).all<{
    name: string;
    deleted_at: string | null;
  }>();
  const fileRow = results[0];
  if (fileRow === undefined || fileRow.deleted_at !== null) throw new WopiRouteError("not-found");

  const cleanVersion = await getCurrentCleanVersion(deps.database, fileId);
  // The live working copy's size supersedes the committed version's once a session has saved.
  const size = deps.currentMeta?.sizeBytes ?? cleanVersion?.sizeBytes ?? 0;
  // Version must change whenever the bytes change: the host-assigned timestamp during a live session,
  // else the committed version's identifier (stable until the next cut).
  const version = deps.currentMeta?.wopiTimestamp ?? cleanVersion?.id ?? "0";

  return {
    BaseFileName: fileRow.name,
    Size: size,
    Version: version,
    // Distinct from UserId so the editor never treats the current user as the file's owner.
    OwnerId: `file:${fileId}`,
    UserId: claims.memberId,
    UserCanWrite: claims.capability === "edit",
    LastModifiedTime: deps.currentMeta?.wopiTimestamp ?? null,
  };
}

export async function getFile(claims: EditTokenClaims, deps: WopiFileDeps): Promise<Response> {
  const fileId = claims.fileId as FileId;

  // An edit session reads the live working copy; before it is materialized (or for a read-only viewer)
  // the committed base version is served. Both keys are derived from the verified token.
  let object: R2ObjectBody | null = null;
  if (claims.capability === "edit") {
    object = await deps.bucket.get(currentObjectKey(fileId));
  }
  object ??= await deps.bucket.get(fileVersionKey(fileId, claims.versionId as FileVersionId));
  if (object === null) throw new WopiRouteError("not-found");

  return new Response(object.body, { status: 200 });
}
