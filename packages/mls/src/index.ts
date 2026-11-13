// The meeting group's key agreement in the browser: one MLS group (RFC 9420) per end-to-end encrypted
// meeting, whose per-epoch exporter secret is the SFrame base key `./sframe.ts` derives frame keys from.
//
// The engine is Rust (crates/mls-core, over OpenMLS and its pure-Rust crypto provider) compiled to
// WebAssembly. It is loaded only when an encrypted meeting is joined. The signing key a session makes is
// held in the module's memory for the length of one stay, and never stored or exported.
//
// Identities are stay handles, group identifiers are meeting handles, and handshake messages are bytes
// the meeting room relays without reading. Every failure is one of `MLS_ERROR_CODES`; none carries a key,
// a credential or a message.
import init, { MlsSession } from "./pkg/mls_core.js";

let ready: Promise<unknown> | undefined;

/**
 * Load the WebAssembly module once: under Node (tests) pass the bytes, in a browser pass nothing and the
 * module fetches its own .wasm beside it.
 */
export async function ensureReady(wasmInput?: Uint8Array | ArrayBuffer): Promise<void> {
  if (ready === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ready = wasmInput !== undefined ? init({ module_or_path: wasmInput as any }) : init();
  }
  await ready;
}

/** The fixed codes an act can be refused with. */
export const MLS_ERROR_CODES = [
  "identity",
  "groupId",
  "keyPackage",
  "identityMismatch",
  "alreadyInGroup",
  "notInGroup",
  "unknownMember",
  "pauseReason",
  "pendingCommit",
  "noPendingCommit",
  "nothingToCommit",
  "malformed",
  "wrongGroup",
  "wrongEpoch",
  "refused",
  "engineFailed",
] as const;
export type MlsErrorCode = (typeof MLS_ERROR_CODES)[number];

export class MlsError extends Error {
  constructor(readonly code: MlsErrorCode) {
    super(code);
    this.name = "MlsError";
  }
}

function asMlsError(error: unknown): MlsError {
  const message = error instanceof Error ? error.message : String(error);
  const code = MLS_ERROR_CODES.find((candidate) => candidate === message);
  return new MlsError(code ?? "engineFailed");
}

function guarded<T>(act: () => T): T {
  try {
    return act();
  } catch (error) {
    throw asMlsError(error);
  }
}

/**
 * Why the group says encryption is paused, as bits: the server can hear the meeting while any of these
 * runs. Zero is encrypted.
 */
export const PAUSE_REASONS = { recording: 0b001, captions: 0b010, phone: 0b100 } as const;
export type PauseReason = keyof typeof PAUSE_REASONS;

/** The reasons a set of pause bits names, in a fixed order. */
export function pauseReasons(bits: number): readonly PauseReason[] {
  return (Object.keys(PAUSE_REASONS) as PauseReason[]).filter(
    (reason) => (bits & PAUSE_REASONS[reason]) !== 0,
  );
}

/** The bits for a set of pause reasons. */
export function pauseBits(reasons: Iterable<PauseReason>): number {
  let bits = 0;
  for (const reason of reasons) bits |= PAUSE_REASONS[reason];
  return bits;
}

export interface GroupMember {
  readonly leafIndex: number;
  readonly identity: string;
}

export interface GroupCommit {
  /** For every member, through the room, in the order the room sequences it. */
  readonly commit: Uint8Array;
  /** For the people the commit admits, when it admits anybody. */
  readonly welcome: Uint8Array | undefined;
}

export type Processed = "committed" | "removed" | "proposed";

/**
 * One participant's side of a meeting's group. `ensureReady` must have finished first. Call `release`
 * when the stay ends: the signing key and every epoch secret are dropped with it.
 */
export class MeetingGroupSession {
  readonly #engine: MlsSession;

  /** A participant whose credential names `identity`, the handle of the stay the room seated them on. */
  constructor(identity: string) {
    this.#engine = guarded(() => new MlsSession(identity));
  }

  /** A key package for the committer to admit this participant with. */
  keyPackage(): Uint8Array {
    return guarded(() => this.#engine.keyPackage());
  }

  /** Start the meeting's group alone, encrypted: the first host to arrive. */
  createGroup(meetingId: string): void {
    guarded(() => this.#engine.createGroup(meetingId));
  }

  /** Join from the welcome the room delivered, refusing one for any other meeting. */
  join(welcome: Uint8Array, meetingId: string): void {
    guarded(() => this.#engine.join(welcome, meetingId));
  }

  /** Stage an admission of the stay the room says sent `keyPackage`. */
  stageAdd(expectedIdentity: string, keyPackage: Uint8Array): void {
    guarded(() => this.#engine.stageAdd(expectedIdentity, keyPackage));
  }

  /** Stage the removal of a member who has gone. */
  stageRemove(identity: string): void {
    guarded(() => this.#engine.stageRemove(identity));
  }

  /** Stage the pause state the next commit writes. */
  stagePause(bits: number): void {
    guarded(() => this.#engine.stagePause(bits));
  }

  /** Commit what is staged and every delivered proposal. Nothing moves until `confirmCommit`. */
  commit(): GroupCommit {
    return guarded(() => {
      const output = this.#engine.commit();
      try {
        return { commit: output.commit, welcome: output.welcome };
      } finally {
        output.free();
      }
    });
  }

  /** The room sequenced this participant's commit: apply it. */
  confirmCommit(): void {
    guarded(() => this.#engine.confirmCommit());
  }

  /** The room sequenced another commit first: forget this one. */
  discardCommit(): void {
    guarded(() => this.#engine.discardCommit());
  }

  /** A proposal to change the pause state, for the committer's next commit to carry. */
  proposePause(bits: number): Uint8Array {
    return guarded(() => this.#engine.proposePause(bits));
  }

  /** Apply a handshake message somebody else sent, in the order the room delivered it. */
  process(message: Uint8Array): Processed {
    return guarded(() => this.#engine.process(message) as Processed);
  }

  get epoch(): number {
    return guarded(() => this.#engine.epoch());
  }

  get ownLeafIndex(): number {
    return guarded(() => this.#engine.ownLeafIndex());
  }

  members(): readonly GroupMember[] {
    return guarded(() => {
      const leafIndexes = this.#engine.memberLeafIndexes();
      const identities = this.#engine.memberIdentities();
      return Array.from(leafIndexes, (leafIndex, position) => ({
        leafIndex,
        identity: identities[position] ?? "",
      }));
    });
  }

  /** Whether this participant commits, given the identities the room says are still connected. */
  isCommitter(liveIdentities: readonly string[]): boolean {
    return guarded(() => this.#engine.isCommitter([...liveIdentities]));
  }

  /** The pause bits the verified group state carries; zero is encrypted. */
  get pause(): number {
    return guarded(() => this.#engine.pause());
  }

  /** The epoch's SFrame base key. Hand it to an `SframeKeyRing` and drop it. */
  sframeBaseKey(): Uint8Array {
    return guarded(() => this.#engine.sframeBaseKey());
  }

  /** Digit groups that match on every screen in the same group with the same people. */
  securityCode(): string {
    return guarded(() => this.#engine.securityCode());
  }

  release(): void {
    this.#engine.free();
  }
}
