/*
 * THIS BROWSER'S PLACE IN AN ENCRYPTED MEETING'S KEY GROUP.
 *
 * An end-to-end encrypted meeting agrees its keys in one MLS group (RFC 9420): every participant is a
 * member, every arrival and departure is a commit, and every commit moves the group to a new epoch
 * whose secret only the members hold. The frame cipher derives each epoch's media keys from that
 * secret, so somebody who has left holds only keys that no longer encrypt anything.
 *
 * THE ROOM IS THE DELIVERY SERVICE AND NOTHING MORE. It relays the four group frames, accepts the
 * first commit made from each epoch and refuses the rest `stale-epoch`, and tells the first stay that
 * asks to found the group. It reads none of the bytes, so nothing here takes the room's word for
 * anything the bytes can say: who is in the group, and whether encryption is paused, are read from
 * the group state this browser verified itself.
 *
 * WHAT THIS MODULE DOES:
 *   - on joining, sends a key package and waits to be welcomed (or told to found the group);
 *   - while it is the committer (the live member with the smallest leaf), admits every key package
 *     waiting and removes every member the roster no longer holds, in one commit;
 *   - applies everybody else's commits in the order the room delivers them, and discards its own
 *     when the room sequenced another first;
 *   - hands the frame cipher each epoch's key the moment the epoch begins.
 *
 * Nothing here touches the browser. The engine is a seam (`EncryptionGroupSeams.createSession`), so
 * a test drives the real WebAssembly engine, or a fake, through exactly the path a meeting does.
 */
import type { GroupCommit, Processed } from "@magna-carta/mls";

/** The engine as this module uses it: `MeetingGroupSession` from `@magna-carta/mls`. */
export interface GroupSession {
  keyPackage(): Uint8Array;
  createGroup(meetingId: string): void;
  join(welcome: Uint8Array, meetingId: string): void;
  stageAdd(expectedIdentity: string, keyPackage: Uint8Array): void;
  stageRemove(identity: string): void;
  commit(): GroupCommit;
  confirmCommit(): void;
  discardCommit(): void;
  proposePause(bits: number): Uint8Array;
  process(message: Uint8Array): Processed;
  readonly epoch: number;
  readonly ownLeafIndex: number;
  members(): readonly { readonly leafIndex: number; readonly identity: string }[];
  isCommitter(liveIdentities: readonly string[]): boolean;
  readonly pause: number;
  sframeBaseKey(): Uint8Array;
  securityCode(): string;
  release(): void;
}

/** What the frame cipher and the screen are told each time the group moves to a new epoch. */
export interface GroupEpoch {
  readonly epoch: number;
  /** The epoch's SFrame base key. The receiver hands it to its key ring and keeps no other copy. */
  readonly baseKey: Uint8Array;
  /** This browser's leaf, which its frames' key identifiers carry. */
  readonly ownLeafIndex: number;
  /** The pause bits the verified group state carries; zero is encrypted. */
  readonly pause: number;
  /** The digits every screen in the same group with the same people shows. */
  readonly securityCode: string;
}

/** Where this browser stands in the group. */
export type GroupStanding =
  /** A key package is out and nothing has answered it yet. */
  | "joining"
  /** In the group, holding the current epoch's key. */
  | "member"
  /** The engine refused something it could not recover from; the meeting is not encrypted here. */
  | "failed";

export interface EncryptionGroupSeams {
  /** A fresh engine session whose credential names this stay. */
  createSession(identity: string): GroupSession;
  /** A frame to the room: one of the three group frames a browser sends. */
  send(frame: Record<string, unknown>): void;
  /** The group moved to a new epoch, or this browser just joined it. */
  onEpoch(epoch: GroupEpoch): void;
  /** This browser's standing changed. The keys are dropped before `joining` and `failed`. */
  onStanding(standing: GroupStanding, failure?: string): void;
  /**
   * When a commit is made. A burst of arrivals is one commit rather than one per person, so the
   * default waits a moment to gather them; a test passes one that runs at once.
   */
  schedule?(task: () => void): void;
}

const COMMIT_GATHER_MILLISECONDS = 50;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array | undefined {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return undefined;
  }
}

/** The engine's refusal code, where the error is one. Never a message: codes carry no content. */
function engineCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "engineFailed";
}

function readString(frame: Record<string, unknown>, field: string): string | undefined {
  const value = frame[field];
  return typeof value === "string" ? value : undefined;
}

function readStrings(frame: Record<string, unknown>, field: string): readonly string[] {
  const value = frame[field];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export class EncryptionGroup {
  readonly #meetingId: string;
  readonly #ownStay: string;
  readonly #seams: EncryptionGroupSeams;
  readonly #schedule: (task: () => void) => void;

  #session: GroupSession | null = null;
  #member = false;
  /** A commit of this browser's is with the room, awaiting its order. */
  #commitOutstanding = false;
  #commitScheduled = false;
  /** Key packages waiting to be admitted, by the stay the room says sent them. */
  readonly #waiting = new Map<string, Uint8Array>();
  /** Who the roster holds now: the committer is chosen from them, and a member not among them goes. */
  #live: readonly string[] = [];
  #stopped = false;

  constructor(meetingId: string, ownStay: string, seams: EncryptionGroupSeams) {
    this.#meetingId = meetingId;
    this.#ownStay = ownStay;
    this.#seams = seams;
    this.#schedule =
      seams.schedule ??
      ((task) => {
        setTimeout(task, COMMIT_GATHER_MILLISECONDS);
      });
  }

  /** Ask to be in the group: a fresh session, and its key package to the room. */
  start(): void {
    this.#session?.release();
    this.#member = false;
    this.#commitOutstanding = false;
    try {
      this.#session = this.#seams.createSession(this.#ownStay);
      const keyPackage = this.#session.keyPackage();
      this.#seams.onStanding("joining");
      this.#seams.send({ type: "mls-key-package", keyPackage: toBase64(keyPackage) });
    } catch (error) {
      this.#fail(error);
    }
  }

  /** The stay is over: the signing key and every epoch secret go with the session. */
  stop(): void {
    this.#stopped = true;
    this.#session?.release();
    this.#session = null;
    this.#member = false;
    this.#waiting.clear();
  }

  /** Who the roster holds now, as stay handles. */
  noteLiveStays(stays: readonly string[]): void {
    this.#live = stays;
    for (const stay of [...this.#waiting.keys()]) {
      if (!stays.includes(stay)) this.#waiting.delete(stay);
    }
    this.#considerCommitting();
  }

  /** One of the four group frames the room sends. */
  receive(frame: Record<string, unknown>): void {
    if (this.#stopped || this.#session === null) return;
    switch (frame.type) {
      case "mls-key-package":
        this.#keyPackage(frame);
        return;
      case "mls-welcome":
        this.#welcome(frame);
        return;
      case "mls-commit":
        this.#commit(frame);
        return;
      case "mls-proposal":
        this.#proposal(frame);
        return;
      default:
        return;
    }
  }

  /**
   * The room refused one of this browser's group frames. `stale-epoch` is another commit sequenced
   * first, which has already arrived and been applied; `not-in-group` means this browser has to ask
   * again.
   */
  refused(reason: string): void {
    if (this.#stopped || this.#session === null) return;
    if (reason === "stale-epoch") {
      if (this.#commitOutstanding) this.#discardOwnCommit();
      this.#considerCommitting();
      return;
    }
    if (reason === "not-in-group") this.start();
  }

  #keyPackage(frame: Record<string, unknown>): void {
    const from = readString(frame, "from");
    const bytes = fromBase64(readString(frame, "keyPackage") ?? "");
    if (from === undefined || bytes === undefined || from === this.#ownStay) return;
    this.#waiting.set(from, bytes);
    this.#considerCommitting();
  }

  #welcome(frame: Record<string, unknown>): void {
    const session = this.#session;
    if (session === null || this.#member) return;
    const welcome = frame.welcome;
    try {
      if (welcome === null) session.createGroup(this.#meetingId);
      else {
        const bytes = typeof welcome === "string" ? fromBase64(welcome) : undefined;
        if (bytes === undefined) return;
        session.join(bytes, this.#meetingId);
      }
    } catch (error) {
      this.#fail(error);
      return;
    }
    this.#member = true;
    this.#seams.onStanding("member");
    this.#announceEpoch();
    this.#considerCommitting();
  }

  #commit(frame: Record<string, unknown>): void {
    const session = this.#session;
    if (session === null || !this.#member) return;
    const from = readString(frame, "from");
    const bytes = fromBase64(readString(frame, "commit") ?? "");
    if (from === undefined || bytes === undefined) return;
    for (const stay of readStrings(frame, "added")) this.#waiting.delete(stay);

    if (from === this.#ownStay && this.#commitOutstanding) {
      try {
        session.confirmCommit();
      } catch (error) {
        this.#fail(error);
        return;
      }
      this.#commitOutstanding = false;
      this.#announceEpoch();
      this.#considerCommitting();
      return;
    }

    // Somebody else's commit was sequenced first: this browser's own is now from a past epoch.
    if (this.#commitOutstanding) this.#discardOwnCommit();
    let processed: Processed;
    try {
      processed = session.process(bytes);
    } catch (error) {
      this.#fail(error);
      return;
    }
    if (processed === "removed") {
      // Out of the group while still in the room — a committer took this stay for gone. Ask again.
      this.start();
      return;
    }
    if (processed === "committed") this.#announceEpoch();
    this.#considerCommitting();
  }

  #proposal(frame: Record<string, unknown>): void {
    const session = this.#session;
    if (session === null || !this.#member) return;
    const bytes = fromBase64(readString(frame, "proposal") ?? "");
    if (bytes === undefined) return;
    try {
      session.process(bytes);
    } catch {
      // A proposal this engine refuses (any but a pause change) is dropped; the group carries on.
      return;
    }
    this.#considerCommitting();
  }

  #discardOwnCommit(): void {
    try {
      this.#session?.discardCommit();
    } catch {
      // Nothing was pending after all; the state asked for is the state there is.
    }
    this.#commitOutstanding = false;
  }

  #considerCommitting(): void {
    if (this.#commitScheduled || this.#commitOutstanding || !this.#member) return;
    this.#commitScheduled = true;
    this.#schedule(() => {
      this.#commitScheduled = false;
      this.#commitIfCommitter();
    });
  }

  /** As the committer: admit everybody waiting and remove everybody gone, in one commit. */
  #commitIfCommitter(): void {
    const session = this.#session;
    if (this.#stopped || session === null || !this.#member || this.#commitOutstanding) return;
    const live = this.#live.includes(this.#ownStay) ? this.#live : [...this.#live, this.#ownStay];
    let committer: boolean;
    try {
      committer = session.isCommitter(live);
    } catch (error) {
      this.#fail(error);
      return;
    }
    if (!committer) return;

    const epoch = session.epoch;
    const added: string[] = [];
    const removed: string[] = [];
    const members = new Set(session.members().map((member) => member.identity));
    for (const identity of members) {
      if (identity !== this.#ownStay && !live.includes(identity)) {
        try {
          session.stageRemove(identity);
          removed.push(identity);
        } catch {
          // Already staged, or already gone; nothing to remove.
        }
      }
    }
    for (const [stay, keyPackage] of this.#waiting) {
      try {
        // A stay already in the group that sends a key package has lost its state — a reload — so
        // its old leaf goes in the same commit that admits the new one.
        if (members.has(stay) && !removed.includes(stay)) {
          session.stageRemove(stay);
          removed.push(stay);
        }
        session.stageAdd(stay, keyPackage);
        added.push(stay);
      } catch {
        // A key package under another stay's name, or one the engine cannot read: never admitted.
        this.#waiting.delete(stay);
      }
    }

    let output: GroupCommit;
    try {
      output = session.commit();
    } catch (error) {
      if (engineCode(error) === "nothingToCommit") return;
      this.#fail(error);
      return;
    }
    this.#commitOutstanding = true;
    this.#seams.send({
      type: "mls-commit",
      epoch,
      commit: toBase64(output.commit),
      ...(output.welcome === undefined ? {} : { welcome: toBase64(output.welcome) }),
      added,
      removed,
    });
  }

  /**
   * Ask the committer to carry a pause change: a host's act, signed into the group, so every browser
   * reads a pause from state it verified rather than from the room's word. The proposal waits in this
   * session too, so a host who is the committer carries it in the next commit.
   */
  proposePause(bits: number): void {
    const session = this.#session;
    if (session === null || !this.#member) return;
    let proposal: Uint8Array;
    try {
      proposal = session.proposePause(bits);
    } catch (error) {
      this.#fail(error);
      return;
    }
    this.#seams.send({
      type: "mls-proposal",
      epoch: session.epoch,
      proposal: toBase64(proposal),
    });
    this.#considerCommitting();
  }

  #announceEpoch(): void {
    const session = this.#session;
    if (session === null) return;
    try {
      this.#seams.onEpoch({
        epoch: session.epoch,
        baseKey: session.sframeBaseKey(),
        ownLeafIndex: session.ownLeafIndex,
        pause: session.pause,
        securityCode: session.securityCode(),
      });
    } catch (error) {
      this.#fail(error);
    }
  }

  #fail(error: unknown): void {
    this.#member = false;
    this.#commitOutstanding = false;
    this.#seams.onStanding("failed", engineCode(error));
  }
}
