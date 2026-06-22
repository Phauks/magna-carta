import { DurableObject } from "cloudflare:workers";
import type { Bindings } from "../app.ts";
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
}

const STATE_KEY = "session-state";
const EMPTY_STATE: DocumentSessionState = {
  participants: {},
  current: null,
  wopiLock: null,
  sessionId: null,
};

// Per-document session coordinator — one instance per open file (addressed by fileId). It holds the
// live session state in its own durable storage (the participant set and the `current` working-object
// metadata), which survives the editing container sleeping or being reaped, so a lock or working state
// is never lost. This skeleton owns state + the session-close cut signal; the Collabora container
// ownership and the WOPI session lock attach in later editing work.
export class DocumentSession extends DurableObject<Bindings> {
  private async load(): Promise<DocumentSessionState> {
    return (await this.ctx.storage.get<DocumentSessionState>(STATE_KEY)) ?? EMPTY_STATE;
  }

  private async save(state: DocumentSessionState): Promise<void> {
    await this.ctx.storage.put(STATE_KEY, state);
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
  // cuts a version — it just adds an editor to the live session.
  async joinEditor(memberId: string): Promise<{ sessionId: string }> {
    const state = await this.load();
    const sessionId = state.sessionId ?? crypto.randomUUID();
    await this.save({
      ...state,
      sessionId,
      participants: { ...state.participants, [memberId]: "edit" },
    });
    return { sessionId };
  }

  // Removes a participant and reports whether the session is now empty — the session-close cut signal
  // (the caller cuts the version from `current`). Only the last editor leaving cuts; others remaining
  // does not. Closing the session also clears its identity so the next open mints a fresh one.
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
    return { sessionClosed };
  }

  // Records the `current` working object's metadata after a PutFile (hash / size / host-assigned
  // timestamp).
  async setCurrentMeta(meta: CurrentObjectMeta): Promise<void> {
    const state = await this.load();
    await this.save({ ...state, current: meta });
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
}
