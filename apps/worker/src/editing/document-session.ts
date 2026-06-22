import { DurableObject } from "cloudflare:workers";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { setFileEditStateStatement } from "@magna-carta/file-manager/file-statements";
import type { FileId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../app.ts";
import { resolveFirmDatabase } from "../firm-binding-resolver.ts";
import { shouldCutVersion } from "./version-cut-trigger.ts";

export type ParticipantCapability = "view" | "edit";

// The `current` working-object metadata recorded after each PutFile: the hash backs the version-cut
// no-op skip, the size feeds metering, and the host-assigned timestamp backs the stale-write guard.
export interface CurrentObjectMeta {
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly wopiTimestamp: string;
}

export interface DocumentSessionState {
  readonly participants: Readonly<Record<string, ParticipantCapability>>;
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
    return (await this.ctx.storage.get<DocumentSessionState>(STATE_KEY)) ?? EMPTY_STATE;
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
  // context. Null when the firm is unreachable from this deployment (nothing the alarm can do).
  private async resolveFirmDatabase(bucketName: string): Promise<D1Database | null> {
    const firm = await this.env.DB_CONTROL.prepare(
      "SELECT database_identifier FROM firm WHERE bucket_name = ?1",
    )
      .bind(bucketName)
      .first<{ database_identifier: string | null }>();
    if (firm === null || firm.database_identifier === null) return null;
    return resolveFirmDatabase(this.env, firm.database_identifier);
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

  // The idle-reap alarm: the window elapsed with no activity re-arming it, so the co-editing session is
  // dead. Free the document (file.edit_state -> idle in the firm database) and clear the live session
  // state. A no-op when the session already closed cleanly (no participants). Cutting a session-close
  // version from `current` on reap is wired with the live editing container (it needs the
  // container-written working copy); until then the reap frees the document so it is never stuck.
  override async alarm(): Promise<void> {
    const state = await this.load();
    if (Object.keys(state.participants).length === 0) return;
    if (state.fileId !== null && state.bucketName !== null) {
      const database = await this.resolveFirmDatabase(state.bucketName);
      if (database !== null) {
        const now = () => new Date().toISOString();
        await commitEffectBatch(
          database,
          {
            statements: [
              setFileEditStateStatement(database, state.fileId as FileId, "idle", now()),
            ],
            outboxMessages: [],
          },
          { now },
        );
      }
    }
    await this.save(EMPTY_STATE);
  }
}
