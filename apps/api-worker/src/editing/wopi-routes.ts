// The WOPI file-access handlers Collabora calls during an editing session. They run AFTER the guard
// has verified the token and resolved the firm database, so they trust the claims for tenancy and
// derive every object key from the token's fileId/versionId — never from the request line. Capability
// is the write gate: UserCanWrite is only a UI hint, so it mirrors the token's capability and the
// mutating handlers (PutFile, Lock) enforce `edit` server-side separately.

import { currentObjectKey, fileVersionKey } from "@magna-carta/file-manager/file-statements";
import { getFileWithNamedVersion, type CleanVersion } from "@magna-carta/file-manager/queries";
import type { FileId, FileVersionId, MatterId } from "@magna-carta/identifiers/types";
import { operationFailed } from "@magna-carta/telemetry/events";
import { newCorrelationId, newErrorId } from "@magna-carta/telemetry/ids";
import type { Logger } from "@magna-carta/telemetry/logger";
import { workingCopyDimensions } from "../files/object-stamping.ts";
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
  // The member's display name, resolved by the caller for CheckFileInfo. The editor labels the
  // member's changes, cursor and seat in the user list with it; absent, it shows an unknown user.
  readonly memberName?: string | null;
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

// What the two file-access handlers agree on before either of them touches R2: the file must still be
// live, and — unless this caller owns the live working copy — the version the TOKEN names must still be
// servable. Both handlers resolve it through this one function, so CheckFileInfo can never advertise a
// document GetFile then refuses (or, worse, refuses a document GetFile happily streams).
//
// Three things are re-checked on every callback, because a token outlives the state it was minted from:
//   - The file was soft-deleted. Its `current` working object is destroyed by the delete, and no read
//     path serves a deleted file — an unexpired token must not be the one exception.
//   - The named version is no longer `clean`. The launch mints a token only against a clean committed
//     version, so a version that has since left `clean` was WITHDRAWN behind the status gate (the
//     custody check found the stored bytes no longer match the hash the version asserts). Streaming it
//     would hand the editor content nothing ever inspected.
//   - The named version's scan verdict has turned `flagged`. A re-scan under a newer engine can flag an
//     already-committed version in place, leaving it visible for informed access on the download path
//     — where a human sees the warning and acknowledges it. There is no such acknowledgment on this
//     surface: the caller is an editor container, so the refusal is the only honest answer here.
//
// Returns the version the token names; throws the WOPI 404 fault otherwise. `null` means "this caller
// owns the live working copy", for which the working copy — not any committed version — is the content.
async function resolveTokenContent(
  claims: EditTokenClaims,
  deps: WopiFileDeps,
): Promise<{ readonly name: string; readonly version: CleanVersion | null }> {
  const file = await getFileWithNamedVersion(
    deps.database,
    claims.fileId as FileId,
    claims.versionId as FileVersionId,
  );
  if (file === undefined || file.deletedAt !== null) throw new WopiRouteError("not-found");
  if (ownsLiveWorkingCopy(claims, deps)) return { name: file.name, version: null };
  if (file.version === null || file.version.scanVerdict === "flagged") {
    throw new WopiRouteError("not-found");
  }
  return { name: file.name, version: file.version };
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
  // The name the editor shows for this member: on their cursor, in the user list, and as the
  // author of their changes. The editor's own guidance is that it is nominally optional and
  // strongly recommended, because without it the member is "UnknownUser" with their identifier.
  readonly UserFriendlyName?: string;
  readonly UserCanWrite: boolean;
  // The host accepts PutFile, which is the editor's capability to save at all.
  readonly SupportsUpdate: boolean;
  // The host ENFORCES locks: `putFile` refuses any save made without a held lock. coolwsd takes a lock
  // only when this property says the host supports them — nothing else makes it send LOCK — so a host
  // that requires a lock it never advertised refuses every save, and the member is told the document
  // was changed by another user each time they press save. Advertised because it is enforced.
  // SupportsGetLock is deliberately absent: the lock handler implements no GET_LOCK.
  readonly SupportsLocks: boolean;
  // True for every member. The editor shows its server audit and update check to administrators
  // only, and the owner's direction is that every seat has the whole editor, audit included, so a
  // member can read the audit to support when asked. No member administers the editing server
  // itself (the image exposes no admin console), so the property grants nothing beyond those screens.
  readonly IsAdminUser: boolean;
  readonly LastModifiedTime: string | null;
  // The origin the editor addresses its status messages to (the WOPI PostMessageOrigin property). It is
  // the app origin that launched this session, carried in the token because this call has no request of
  // its own to read it from. Absent, the editor posts nothing and the screen framing it has no way to
  // learn that the document came up — which is the difference between a member watching a waiting state
  // that resolves and one watching a blank frame.
  readonly PostMessageOrigin?: string;
}

export async function checkFileInfo(
  claims: EditTokenClaims,
  deps: WopiFileDeps,
): Promise<CheckFileInfoBody> {
  const fileId = claims.fileId as FileId;
  // One round-trip: the file row + the version the TOKEN names (this runs on every WOPI callback).
  // Deliberately the token's version rather than the file's current pointer — a version cut by another
  // writer mid-token advances that pointer while GetFile still serves the version this token was minted
  // for, so reporting the current version's size and identifier would describe bytes no caller receives.
  const { name, version } = await resolveTokenContent(claims, deps);

  // The live working copy's metadata is reported ONLY to the session that owns it — the same gate GetFile
  // serves the bytes under, so the size/version this call advertises always describes the bytes the next
  // GetFile returns. (`version === null` IS that ownership, resolved once above.)
  const liveWorkingCopy = version === null ? deps.currentMeta : null;
  // The live working copy's size supersedes the committed version's once that session has saved.
  const size = liveWorkingCopy?.sizeBytes ?? version?.sizeBytes ?? 0;
  // Version must change whenever the bytes change: the host-assigned timestamp during a live session,
  // else the token's committed version identifier (immutable, so it is stable for this token's life).
  const wopiVersion = liveWorkingCopy?.wopiTimestamp ?? version?.id ?? "0";

  return {
    BaseFileName: name,
    Size: size,
    Version: wopiVersion,
    // Distinct from UserId so the editor never treats the current user as the file's owner.
    OwnerId: `file:${fileId}`,
    UserId: claims.memberId,
    ...(deps.memberName === undefined || deps.memberName === null
      ? {}
      : { UserFriendlyName: deps.memberName }),
    UserCanWrite: claims.capability === "edit",
    SupportsUpdate: true,
    SupportsLocks: true,
    IsAdminUser: true,
    LastModifiedTime: liveWorkingCopy?.wopiTimestamp ?? null,
    // Only ever the origin the token carries. The property is omitted rather than defaulted when the
    // token has none: a guessed origin would not match the page and the messages would go nowhere, which
    // is the same silence with a configuration value standing behind it.
    ...(claims.appOrigin === undefined ? {} : { PostMessageOrigin: claims.appOrigin }),
  };
}

export async function getFile(claims: EditTokenClaims, deps: WopiFileDeps): Promise<Response> {
  const fileId = claims.fileId as FileId;

  // The same live/deleted/withdrawn/flagged gate CheckFileInfo answers under. A valid, unexpired token
  // is a capability over ONE version of one file, not a standing right to that file's bytes — so the
  // firm metadata is re-read here rather than trusted from mint time, and the two handlers refuse
  // together instead of one 404ing while the other streams.
  const { version } = await resolveTokenContent(claims, deps);

  // Exactly one object is served, and which one is decided BEFORE any read: the live working copy when
  // the token's session owns it, otherwise the immutable version the token names. There is no fallback
  // between the two — falling back would silently hand the caller different bytes under the size and
  // version CheckFileInfo already advertised, which for an editor means saving edits onto the wrong base.
  // Both keys are derived from the verified token, never the request line.
  const key =
    version === null
      ? currentObjectKey(fileId)
      : fileVersionKey(fileId, claims.versionId as FileVersionId);
  const object = await deps.bucket.get(key);
  if (object === null) throw new WopiRouteError("not-found");

  return new Response(object.body, { status: 200 });
}

// What kind of save a PutFile is, read off the headers the editor sets on every one. A member's own
// Save and the save made as the last view leaves are moments to keep as versions; the autosave every
// few minutes is the working copy keeping up, and is not.
export type SaveKind = "explicit" | "autosave" | "exit";

export function saveKindOf(headers: Headers): SaveKind {
  if (headers.get("X-COOL-WOPI-IsExitSave") === "true") return "exit";
  if (headers.get("X-COOL-WOPI-IsAutosave") === "true") return "autosave";
  return "explicit";
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
  // The working copy carries its own class, distinct from a committed version's: these are the bytes
  // somebody is part-way through typing, and a reader that cannot tell the two apart would serve an
  // unsaved draft as the firm's document. The matter comes from the signed token, which this host
  // minted — never from the request line.
  const putPromise = deps.bucket.put(currentObjectKey(fileId), toStore, {
    customMetadata: workingCopyDimensions(claims.matterId as MatterId),
  });
  const digestStream = new DigestStream("SHA-256");
  await toHash.pipeThrough(counter).pipeTo(digestStream);
  await putPromise;
  const sha256 = toHex(await digestStream.digest);

  const wopiTimestamp = deps.now();
  await deps.recordCurrentMeta({ sha256, sizeBytes, wopiTimestamp });

  // The new timestamp goes back as the body the editor's guidance names: a JSON object carrying
  // LastModifiedTime, which the editor reads to know the document it holds is the one in storage,
  // so the next save presents a fresh, matching value. An empty body is logged by the editor as an
  // invalid answer and its change detection goes without. The header is kept beside it for the
  // reader of a trace, where a body is not always at hand.
  return Response.json(
    { LastModifiedTime: wopiTimestamp },
    { status: 200, headers: { "X-COOL-WOPI-Timestamp": wopiTimestamp } },
  );
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
      // A DIFFERENT value is a successor instance of the editor container taking over, so it takes the
      // lock. Exactly one container ever serves a document (it is keyed by the document), and the
      // coolwsd inside it holds one lock token per open document that every co-editor on that container
      // shares — co-editors present the SAME value, the join above. So a mismatch can only come from a
      // new instance after the previous one stopped without unlocking: the container sleeps after idle,
      // and a lock it left in the session object would otherwise block the document until an unlock
      // that never comes, with the member told another user holds it. Only a plain LOCK takes over;
      // UNLOCK, REFRESH_LOCK and UnlockAndRelock still refuse a mismatch, so an old instance cannot
      // release or refresh a successor's lock. The trade: a 409 here protected against a second WOPI
      // client on the same document, which this topology cannot produce.
      await deps.setLock(requestedLock);
      return lockOk();
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
