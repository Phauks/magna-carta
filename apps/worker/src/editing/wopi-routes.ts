// The WOPI file-access handlers Collabora calls during an editing session. They run AFTER the guard
// has verified the token and resolved the firm database, so they trust the claims for tenancy and
// derive every object key from the token's fileId/versionId — never from the request line. Capability
// is the write gate: UserCanWrite is only a UI hint, so it mirrors the token's capability and the
// mutating handlers (PutFile, Lock) enforce `edit` server-side separately.

import { currentObjectKey, fileVersionKey } from "@magna-carta/file-manager/file-statements";
import { getFileWithCurrentCleanVersion } from "@magna-carta/file-manager/queries";
import type { FileId, FileVersionId } from "@magna-carta/identifiers/types";
import { operationFailed } from "@magna-carta/telemetry/events";
import { newCorrelationId, newErrorId } from "@magna-carta/telemetry/ids";
import type { Logger } from "@magna-carta/telemetry/logger";
import type { ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import type { CurrentObjectMeta } from "./document-session.ts";
import { assertEditCapability, WopiGuardError } from "./wopi-guard.ts";
import type { EditTokenClaims } from "./wopi-token.ts";

// crypto.DigestStream is a Workers runtime extension (absent from @types/node), so it is reached
// through a narrow cast — the same primitive the ingest pipeline hashes uploads with. It lets a
// PutFile hash an arbitrarily large body while it streams to R2, never buffering a second copy.
interface DigestStreamConstructor {
  new (algorithm: string): WritableStream<Uint8Array> & { readonly digest: Promise<ArrayBuffer> };
}
const DigestStream = (crypto as unknown as { DigestStream: DigestStreamConstructor }).DigestStream;

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

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
// written `current` yet); `liveSessionId` is the session identity the DO currently holds (null when no
// editing session is live). Together they decide whether this caller may read the live working copy.
export interface WopiFileDeps {
  readonly database: ProxyBatchDatabase;
  readonly bucket: R2Bucket;
  readonly currentMeta: CurrentObjectMeta | null;
  readonly liveSessionId: string | null;
}

// Whether the token's session owns the live working copy — the one condition under which the mutable
// `files/{fileId}/current` object is the right content for this caller. All three must hold: an editing
// session is live, the token was minted for THAT session, and the session has recorded a working copy it
// wrote. Anything else reads the immutable version the token names.
//
// The token's session id is the ownership proof, not its capability: `current` is one mutable object per
// file that outlives the session that wrote it (a reap cuts a version but leaves the object in place), so
// gating on capability alone hands a NEW editing session a stale working copy as its base, and hands any
// token minted outside the live session bytes it was never scoped to. Reading is never blocked by this —
// a read-only viewer that joined the live session carries its session id and follows the live edits;
// everyone else still gets the committed version their token names.
function ownsLiveWorkingCopy(
  claims: EditTokenClaims,
  deps: Pick<WopiFileDeps, "currentMeta" | "liveSessionId">,
): boolean {
  return (
    deps.liveSessionId !== null &&
    deps.currentMeta !== null &&
    claims.sessionId === deps.liveSessionId
  );
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
  // One round-trip: the file row + its current clean version (this runs on every WOPI callback).
  const file = await getFileWithCurrentCleanVersion(deps.database, fileId);
  if (file === undefined || file.deletedAt !== null) throw new WopiRouteError("not-found");

  const cleanVersion = file.currentVersion;
  // The live working copy's metadata is reported ONLY to the session that owns it — the same gate GetFile
  // serves the bytes under, so the size/version this call advertises always describes the bytes the next
  // GetFile returns.
  const liveWorkingCopy = ownsLiveWorkingCopy(claims, deps) ? deps.currentMeta : null;
  // The live working copy's size supersedes the committed version's once that session has saved.
  const size = liveWorkingCopy?.sizeBytes ?? cleanVersion?.sizeBytes ?? 0;
  // Version must change whenever the bytes change: the host-assigned timestamp during a live session,
  // else the committed version's identifier (stable until the next cut).
  const version = liveWorkingCopy?.wopiTimestamp ?? cleanVersion?.id ?? "0";

  return {
    BaseFileName: file.name,
    Size: size,
    Version: version,
    // Distinct from UserId so the editor never treats the current user as the file's owner.
    OwnerId: `file:${fileId}`,
    UserId: claims.memberId,
    UserCanWrite: claims.capability === "edit",
    LastModifiedTime: liveWorkingCopy?.wopiTimestamp ?? null,
  };
}

export async function getFile(claims: EditTokenClaims, deps: WopiFileDeps): Promise<Response> {
  const fileId = claims.fileId as FileId;

  // Exactly one object is served, and which one is decided BEFORE any read: the live working copy when
  // the token's session owns it, otherwise the immutable version the token names. There is no fallback
  // between the two — falling back would silently hand the caller different bytes under the size and
  // version CheckFileInfo already advertised, which for an editor means saving edits onto the wrong base.
  // Both keys are derived from the verified token, never the request line.
  const key = ownsLiveWorkingCopy(claims, deps)
    ? currentObjectKey(fileId)
    : fileVersionKey(fileId, claims.versionId as FileVersionId);
  const object = await deps.bucket.get(key);
  if (object === null) throw new WopiRouteError("not-found");

  return new Response(object.body, { status: 200 });
}

// The bindings + live-session state a PutFile needs. `recordCurrentMeta` persists the new working-copy
// metadata on the session Durable Object; `now` supplies the host-assigned modification timestamp
// (injected so it is deterministic in tests).
export interface PutFileDeps {
  readonly bucket: R2Bucket;
  readonly currentMeta: CurrentObjectMeta | null;
  // The document's single WOPI lock at call time. A PutFile must hold the lock — an unlocked PutFile is
  // refused per the WOPI contract (distinct from the timestamp conflict). Null = no lock held.
  readonly currentLock: string | null;
  readonly recordCurrentMeta: (meta: CurrentObjectMeta) => Promise<void>;
  readonly now: () => string;
}

export async function putFile(
  claims: EditTokenClaims,
  request: Request,
  deps: PutFileDeps,
): Promise<Response> {
  // Capability is enforced server-side; a view token never reaches the write.
  assertEditCapability(claims);

  // WOPI lock gate (checked BEFORE the body is read/tee'd — once tee'd the stream is committed and a
  // clean 409 is no longer possible without a half-written object). An editing session always holds the
  // lock during a save, so a PutFile with no lock held is a contract violation (a stray/replayed write
  // after the lock was released): refuse it with the WOPI 409 + the held value (empty when unlocked),
  // distinct from the timestamp-conflict 409 above. Nothing is written.
  if (deps.currentLock === null) {
    return new Response(null, { status: 409, headers: { "X-WOPI-Lock": "" } });
  }

  // The host is authoritative for the working-copy timestamp. When the editor presents one that no
  // longer matches the session's recorded value, the document in the editor is stale relative to
  // storage, so the save is refused (the bytes are not written) with the Collabora conflict code.
  const presentedTimestamp = request.headers.get("X-COOL-WOPI-Timestamp");
  if (
    deps.currentMeta !== null &&
    presentedTimestamp !== null &&
    presentedTimestamp !== deps.currentMeta.wopiTimestamp
  ) {
    return Response.json({ COOLStatusCode: 1010 }, { status: 409 });
  }

  const fileId = claims.fileId as FileId;
  const body = request.body ?? new ReadableStream<Uint8Array>({ start: (c) => c.close() });

  // Hash, size and store in one pass: one tee branch streams into R2, the other through a byte counter
  // into the digest. Neither buffers the document, so a multi-hundred-megabyte working copy never
  // lands in isolate memory.
  let sizeBytes = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      sizeBytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const [toStore, toHash] = body.tee();
  const putPromise = deps.bucket.put(currentObjectKey(fileId), toStore);
  const digestStream = new DigestStream("SHA-256");
  await toHash.pipeThrough(counter).pipeTo(digestStream);
  await putPromise;
  const sha256 = toHex(await digestStream.digest);

  const wopiTimestamp = deps.now();
  await deps.recordCurrentMeta({ sha256, sizeBytes, wopiTimestamp });

  // Echo the new timestamp so the editor's next save presents a fresh, matching value.
  return new Response(null, { status: 200, headers: { "X-COOL-WOPI-Timestamp": wopiTimestamp } });
}

// The single session lock held in the document's Durable Object. One lock per document: the first
// editor takes it, co-editors present the same value (a join, not a relock), and the last leaver
// releases it. `setLock`/`clearLock` persist the change on the DO.
export interface WopiLockDeps {
  readonly currentLock: string | null;
  readonly setLock: (value: string) => Promise<void>;
  readonly clearLock: () => Promise<void>;
}

// A 409 carrying the lock currently held — the WOPI contract requires the held value (empty when
// unlocked) so the editor can reconcile. A successful lock response carries no X-WOPI-Lock header.
function lockConflict(currentLock: string | null): Response {
  return new Response(null, { status: 409, headers: { "X-WOPI-Lock": currentLock ?? "" } });
}
const lockOk = (): Response => new Response(null, { status: 200 });

export async function lockOperation(
  claims: EditTokenClaims,
  request: Request,
  deps: WopiLockDeps,
): Promise<Response> {
  // Every lock operation mutates session state, so it is an edit-capability gate.
  assertEditCapability(claims);

  const override = request.headers.get("X-WOPI-Override");
  const requestedLock = request.headers.get("X-WOPI-Lock") ?? "";
  // UnlockAndRelock shares the LOCK override and is distinguished only by carrying X-WOPI-OldLock.
  const oldLock = request.headers.get("X-WOPI-OldLock");
  const { currentLock } = deps;

  switch (override) {
    case "LOCK": {
      if (oldLock !== null) {
        // UnlockAndRelock: the old lock must match before swapping in the new one.
        if (currentLock !== oldLock) return lockConflict(currentLock);
        await deps.setLock(requestedLock);
        return lockOk();
      }
      if (currentLock === null) {
        await deps.setLock(requestedLock);
        return lockOk();
      }
      // A matching value is a co-editor joining the live session — already held, nothing to do.
      if (currentLock === requestedLock) return lockOk();
      return lockConflict(currentLock);
    }
    case "UNLOCK": {
      if (currentLock !== requestedLock) return lockConflict(currentLock);
      await deps.clearLock();
      return lockOk();
    }
    case "REFRESH_LOCK": {
      // The lock expiry is renewed by the alarm keep-alive; refresh only validates ownership here.
      if (currentLock !== requestedLock) return lockConflict(currentLock);
      return lockOk();
    }
    default:
      return new Response(null, { status: 400 });
  }
}

// The WOPI guard/route fault codes mapped to the HTTP status coolwsd expects; an unmapped throw is an
// unexpected server fault (500).
const WOPI_FAULT_STATUS: Record<string, number> = {
  unauthorized: 401,
  "not-found": 404,
  "forbidden-readonly": 403,
};

export interface WopiDiagnosticsDeps {
  readonly logger: Logger;
  readonly now: () => string;
  // A correlation id to thread through; minted per callback when absent (this token surface does not
  // ride the request-path telemetry middleware that would otherwise supply one).
  readonly correlationId?: string;
}

// Runs one WOPI callback with the surface's diagnostics. A thrown fault is mapped to the WOPI-contract
// status and recorded as ONE redacted operation.failed event carrying an error id; the same error id
// is returned in X-MC-Error-Id so a support trace joins the client-visible failure. The event's
// allowlist has no field for the document bytes or the access token, so neither can ever be logged.
export async function runWopiCallback(
  operation: string,
  deps: WopiDiagnosticsDeps,
  fn: () => Promise<Response>,
): Promise<Response> {
  const correlationId = deps.correlationId ?? newCorrelationId();
  try {
    return await fn();
  } catch (error) {
    const errorId = newErrorId();
    const code =
      error instanceof WopiGuardError || error instanceof WopiRouteError ? error.code : undefined;
    const status = (code !== undefined ? WOPI_FAULT_STATUS[code] : undefined) ?? 500;
    deps.logger.log(
      operationFailed(
        { correlationId, now: deps.now() },
        {
          operation,
          errorName: error instanceof Error ? error.name : "Error",
          messageHead: error instanceof Error ? error.message.slice(0, 200) : "",
          errorId,
        },
      ),
    );
    return new Response(null, { status, headers: { "X-MC-Error-Id": errorId } });
  }
}
