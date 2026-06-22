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
}

const STATE_KEY = "session-state";
const EMPTY_STATE: DocumentSessionState = { participants: {}, current: null };

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

  // Removes a participant and reports whether the session is now empty — the session-close cut signal
  // (the caller cuts the version from `current`). Only the last editor leaving cuts; others remaining
  // does not.
  async dropParticipant(memberId: string): Promise<{ sessionClosed: boolean }> {
    const state = await this.load();
    const participants = { ...state.participants };
    delete participants[memberId];
    await this.save({ ...state, participants });
    const remaining = Object.keys(participants).length;
    return {
      sessionClosed: shouldCutVersion({
        type: "participant-left",
        remainingParticipants: remaining,
      }),
    };
  }

  // Records the `current` working object's metadata after a PutFile (hash / size / host-assigned
  // timestamp).
  async setCurrentMeta(meta: CurrentObjectMeta): Promise<void> {
    const state = await this.load();
    await this.save({ ...state, current: meta });
  }
}
