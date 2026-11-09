import { DurableObject } from "cloudflare:workers";
import type { EffectStatement } from "@magna-carta/data-access/effect-batch";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { OutboxMessage } from "@magna-carta/data-access/outbox-statements";
import {
  markVersionExportCopyPendingStatement,
  needsExportCopy,
} from "@magna-carta/file-manager/export-copy";
import { commitEditedVersion } from "@magna-carta/file-manager/file-service";
import {
  currentObjectKey,
  setFileEditStateStatement,
  selectFileStatement,
} from "@magna-carta/file-manager/file-statements";
import type { FileId, UserId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../bindings.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import { copyObjectPreservingDimensions } from "../files/object-stamping.ts";
import { firmDatabaseFor, type ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import { shouldCutVersion } from "./version-cut-trigger.ts";

export type ParticipantCapability = "view" | "edit";

// The `current` working-object metadata recorded after each PutFile: the hash backs the version-cut
// no-op skip, the size feeds metering, and the host-assigned timestamp backs the stale-write guard.
export interface CurrentObjectMeta {
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly wopiTimestamp: string;
}

// One WOPI callback as the host answered it, recorded so the screen that launched the editor can see
// what the editor asked for and what it was told. The status and the Error ID are the host's own
// answer to that call; nothing of the document travels here.
export interface OpenCallback {
  readonly operation: string;
  readonly status: number;
  readonly errorId: string | null;
  readonly at: string;
}

// Where one member's open of this document has got to, as seen from the host. The screen framing
// the editor can watch the editor come up, but the editor's calls back to this host happen inside the
// container, out of the browser's sight — and every failure this path has had was in one of those
// calls. So the host records the two calls that decide whether a document opens: CheckFileInfo, the
// editor asking what the document is, and GetFile, the editor asking for its bytes. `launchedAt` is
// when the launch was answered; the marks are null until each call arrives, and a mark that never
// arrives is the finding. Keyed by member, because one document can be open on several screens.
export interface OpenProgress {
  readonly launchedAt: string;
  readonly checkFileInfoAt: string | null;
  readonly getFileAt: string | null;
  readonly lastCallback: OpenCallback | null;
  // Every callback of this open, oldest first, capped: the screen shows the editor's side of the
  // open as a log, not only its last line. A record written before this field existed reads as
  // an empty list.
  readonly callbacks: readonly OpenCallback[];
}

/** How many callbacks one open keeps. An open is four or five; the rest is room for a long session. */
const MAX_OPEN_CALLBACKS = 30;

export interface DocumentSessionState {
  readonly participants: Readonly<Record<string, ParticipantCapability>>;
  // Each member's most recent open of this document, from the launch on (OpenProgress). Reset at
  // every launch so a retry never reads the marks of the attempt before it.
  readonly opens: Readonly<Record<string, OpenProgress>>;
  readonly current: CurrentObjectMeta | null;
  // The single WOPI lock for this document — one per session, shared by co-editors, null when no
  // editing session holds it.
  readonly wopiLock: string | null;
  // The shared session identity: minted when the first editor opens the document, carried in every
  // co-editor's access token so they join one session, and cleared when the last editor leaves. Null
  // when no editing session is live.
  readonly sessionId: string | null;
  // The reap context — the file this session belongs to and the firm's bucket — recorded when an
  // editing session opens so the idle alarm (a fresh invocation that carries no request context) can
  // resolve the firm database and free the document. Null until an editor opens a session.
  readonly fileId: string | null;
  readonly bucketName: string | null;
}

// The idle-reap window: an editing session with no activity for this long is assumed dead and reaped.
// Generous so a live-but-quiet editor is never reaped out from under a user; the final value is set
// from the measured Collabora keep-alive cadence once the editing container is deployed.
const REAP_WINDOW_MS = 30 * 60 * 1000;

const STATE_KEY = "session-state";
const EMPTY_STATE: DocumentSessionState = {
  participants: {},
  opens: {},
  current: null,
  wopiLock: null,
  sessionId: null,
  fileId: null,
  bucketName: null,
};

// Per-document session coordinator — one instance per open file (addressed by fileId). It holds the
// live session state in its own durable storage (the participant set and the `current` working-object
// metadata), which survives the editing container sleeping or being reaped, so a lock or working state
// is never lost. It also owns the idle-reap alarm: a dead co-editing session is freed (file.edit_state
// -> idle) without a human or the container having to notice.
export class DocumentSession extends DurableObject<Bindings> {
  private async load(): Promise<DocumentSessionState> {
    // Over the empty state, so a record persisted before a field existed reads that field as empty
    // rather than undefined: `opens` was added after sessions were already live.
    const stored = await this.ctx.storage.get<Partial<DocumentSessionState>>(STATE_KEY);
    return stored === undefined ? EMPTY_STATE : { ...EMPTY_STATE, ...stored };
  }

  private async save(state: DocumentSessionState): Promise<void> {
    await this.ctx.storage.put(STATE_KEY, state);
  }

  // Pushes the idle-reap alarm out to now + the window. Every editor activity (a join, a save) re-arms
  // it, so the alarm only fires when the window elapses with no activity at all — the idle-timer idiom.
  private async armReapAlarm(): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + REAP_WINDOW_MS);
  }

  // Resolves the firm database from the session's bucket through the control plane — the same seam the
  // ingest consumer uses, since the alarm is a fresh invocation that never saw the request's firm
  // context. The FirmDatabase Durable Object is addressed by firmId and self-migrates on first access.
  // Null when the firm row is absent — a firm this deployment cannot reach (nothing the alarm can do).
  private async resolveFirmDatabase(bucketName: string): Promise<ProxyBatchDatabase | null> {
    const firm = await this.env.DB_CONTROL.prepare("SELECT id FROM firm WHERE bucket_name = ?1")
      .bind(bucketName)
      .first<{ id: string }>();
    if (firm === null) return null;
    return firmDatabaseFor(this.env.FIRM_DATABASE, firm.id);
  }

  async getState(): Promise<DocumentSessionState> {
    return this.load();
  }

  // Adds (or re-confirms) a participant. A co-author joining never cuts a version — the live session
  // simply gains an editor.
  async recordParticipant(memberId: string, capability: ParticipantCapability): Promise<void> {
    const state = await this.load();
    await this.save({ ...state, participants: { ...state.participants, [memberId]: capability } });
  }

  // Joins this member to the editing session as an editor, minting the shared session id on the first
  // join and reusing it for every co-editor after, and returns it for the access token. A join never
  // cuts a version — it just adds an editor to the live session. The reap context (file + bucket) is
  // recorded on the first join and the idle alarm armed/re-armed on every join (the heartbeat).
  async joinEditor(
    memberId: string,
    context?: { fileId: string; bucketName: string | null },
  ): Promise<{ sessionId: string }> {
    const state = await this.load();
    const sessionId = state.sessionId ?? crypto.randomUUID();
    await this.save({
      ...state,
      sessionId,
      participants: { ...state.participants, [memberId]: "edit" },
      fileId: context?.fileId ?? state.fileId,
      bucketName: context?.bucketName ?? state.bucketName,
    });
    await this.armReapAlarm();
    return { sessionId };
  }

  // Removes a participant and reports whether the session is now empty — the session-close cut signal
  // (the caller cuts the version from `current`). Only the last editor leaving cuts; others remaining
  // does not. Closing the session also clears its identity so the next open mints a fresh one, and
  // cancels the idle-reap alarm (a clean close needs no reap).
  async dropParticipant(memberId: string): Promise<{ sessionClosed: boolean }> {
    const state = await this.load();
    const participants = { ...state.participants };
    delete participants[memberId];
    const remaining = Object.keys(participants).length;
    const sessionClosed = shouldCutVersion({
      type: "participant-left",
      remainingParticipants: remaining,
    });
    await this.save({ ...state, participants, sessionId: sessionClosed ? null : state.sessionId });
    if (sessionClosed) await this.ctx.storage.deleteAlarm();
    return { sessionClosed };
  }

  // Records the `current` working object's metadata after a PutFile (hash / size / host-assigned
  // timestamp) and re-arms the idle alarm — a save is editor activity.
  async setCurrentMeta(meta: CurrentObjectMeta): Promise<void> {
    const state = await this.load();
    await this.save({ ...state, current: meta });
    await this.armReapAlarm();
  }

  // Starts a fresh open record for this member: the launch was answered at `launchedAt`, and nothing
  // has arrived from the editor yet. Every launch calls this, a view launch included, so the marks a
  // screen reads are always those of the attempt it is watching.
  async beginOpen(memberId: string, launchedAt: string): Promise<void> {
    const state = await this.load();
    await this.save({
      ...state,
      opens: {
        ...state.opens,
        [memberId]: {
          launchedAt,
          checkFileInfoAt: null,
          getFileAt: null,
          lastCallback: null,
          callbacks: [],
        },
      },
    });
  }

  // Records one WOPI callback against the member's current open, and sets the mark it decides: a
  // CheckFileInfo the host answered 2xx is the editor knowing what the document is, a GetFile answered
  // 2xx is the editor holding its bytes. A callback with no open on record (an editor that outlived
  // the screen's record, a session rebuilt from storage) is recorded as the last callback alone, so
  // the answer the editor got is never lost for want of a launch.
  async recordCallback(memberId: string, callback: OpenCallback): Promise<void> {
    const state = await this.load();
    const open = state.opens[memberId] ?? {
      launchedAt: callback.at,
      checkFileInfoAt: null,
      getFileAt: null,
      lastCallback: null,
      callbacks: [],
    };
    const callbacks = [...(open.callbacks ?? []), callback].slice(-MAX_OPEN_CALLBACKS);
    const answered = callback.status >= 200 && callback.status < 300;
    // A callback is the editor alive on this document, whatever it asked: a lock refresh or a
    // CheckFileInfo from a member who has typed nothing is still a live session, and reaping it
    // out from under them turns their next save into a refusal (the edit token's session no
    // longer matches). Only a join and a save re-armed the idle alarm before this.
    if (state.sessionId !== null) await this.armReapAlarm();
    await this.save({
      ...state,
      opens: {
        ...state.opens,
        [memberId]: {
          ...open,
          checkFileInfoAt:
            answered && callback.operation === "wopi:check-file-info"
              ? callback.at
              : open.checkFileInfoAt,
          getFileAt:
            answered && callback.operation === "wopi:get-file" ? callback.at : open.getFileAt,
          lastCallback: callback,
          callbacks,
        },
      },
    });
  }

  // The member's current open, or null when this document has recorded no launch for them.
  async openProgressOf(memberId: string): Promise<OpenProgress | null> {
    const open = (await this.load()).opens[memberId];
    return open === undefined ? null : { ...open, callbacks: open.callbacks ?? [] };
  }

  // Takes (or replaces) the document's single WOPI lock — the WOPI lock-family handlers persist the
  // current value here so it survives the editing container sleeping.
  async setWopiLock(value: string): Promise<void> {
    const state = await this.load();
    await this.save({ ...state, wopiLock: value });
  }

  // Releases the WOPI lock when the last editor leaves.
  async clearWopiLock(): Promise<void> {
    const state = await this.load();
    await this.save({ ...state, wopiLock: null });
  }

  // Force-closes the live session — used when the file is soft-deleted out from under any editors.
  // Clears the participant set, lock, and session id and cancels the idle-reap alarm. Cutting a
  // session-close version from `current` is wired with the live editing container; the soft-delete
  // path destroys `current` regardless.
  async forceClose(): Promise<void> {
    await this.save(EMPTY_STATE);
    await this.ctx.storage.deleteAlarm();
  }

  // The idle-reap alarm: the window elapsed with no activity re-arming it, so the co-editing session is
  // dead. Before freeing the document, cut an immutable version from the live `current` working object
  // so a dead session never loses unsaved edits — the same version-cut a clean session-close would do.
  // The cut is a no-op until a working copy exists (`current` null, the pre-container reality) and a
  // no-op when nothing changed since the last version (commitEditedVersion's SHA-256 skip). Then free
  // the document (file.edit_state -> idle) and clear the live session state. A no-op overall when the
  // session already closed cleanly (no participants).
  override async alarm(): Promise<void> {
    const state = await this.load();
    if (Object.keys(state.participants).length === 0) return;
    if (state.fileId !== null && state.bucketName !== null) {
      // The session already carries the firm's bucket name — the same name resolveFirmDatabase looks the
      // firm up by — so the working copy is promoted inside that bucket rather than the bound one.
      const { bucket } = resolveFirmBucket(this.env, state.bucketName);
      const database = await this.resolveFirmDatabase(state.bucketName);
      if (database !== null) {
        const fileId = state.fileId as FileId;
        const now = () => new Date().toISOString();
        const statements: EffectStatement[] = [];
        const outboxMessages: OutboxMessage[] = [];

        // Preserve the working copy as a version if a session participant produced one. The author is a
        // session participant (the precise last writer is not tracked; any participant is a faithful
        // attribution for an auto-cut). commitEditedVersion copies `current` server-side into the new
        // version's key and skips when the bytes match the latest committed version.
        const participants = Object.keys(state.participants) as UserId[];
        const author = participants[0];
        if (state.current !== null && author !== undefined) {
          const committed = await commitEditedVersion(
            database,
            {
              fileId,
              currentR2Key: currentObjectKey(fileId),
              contentSha256: state.current.sha256,
              sizeBytes: state.current.sizeBytes,
              uploadedBy: author,
              saveKind: "reap",
              participants,
            },
            { clock: { now }, actorUserId: author },
            async (fromKey, toKey) => {
              await copyObjectPreservingDimensions(bucket, fromKey, toKey, "working-document");
            },
          );
          statements.push(...committed.effect.statements);
          outboxMessages.push(...committed.effect.outboxMessages);
          // A word-processing version owes its export copy (every change accepted) from the moment
          // it exists — see ./working-copy-version.ts. The reap has no request to ask the queue
          // from; the relay's publication of the commit reaches the copy's consumer as its backstop,
          // and a download in between makes the pending copy on the spot.
          if (!committed.skipped) {
            const { results } = await selectFileStatement(database, fileId).all<{ name: string }>();
            if (needsExportCopy(results[0]?.name ?? "", "reap")) {
              statements.push(markVersionExportCopyPendingStatement(database, committed.versionId));
            }
          }
        }

        statements.push(setFileEditStateStatement(database, fileId, "idle", now()));
        await commitEffectBatch(database, { statements, outboxMessages }, { now });
      }
    }
    await this.save(EMPTY_STATE);
  }
}

// The per-document session coordinator stub, narrowed to the concrete class for its typed RPC (the
// binding is intentionally unparameterized in Bindings to avoid a circular import with the DO class).
// One helper so every caller addresses the session the same way (by fileId).
export function documentSessionStub(
  env: Bindings,
  fileId: string,
): DurableObjectStub<DocumentSession> {
  return env.DOCUMENT_SESSION.get(
    env.DOCUMENT_SESSION.idFromName(fileId),
  ) as DurableObjectStub<DocumentSession>;
}
