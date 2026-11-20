/*
 * WHAT AN ENCRYPTED MEETING'S SCREEN SAYS ABOUT ITS ENCRYPTION: the one projection the pause banner,
 * the security panel and the header's mark all read, so the three cannot disagree.
 *
 * EVERY FACT HERE COMES FROM THE GROUP STATE THIS BROWSER VERIFIED. Whether encryption is paused,
 * and why, is the pause flag a host committed into the MLS group context; who is in the group is the
 * group's own member list, each identity the stay its credential names. The room's roster is used
 * only to put a NAME on a stay the group already holds, never to decide who is in it: a member the
 * roster does not know is still shown, unnamed, because the group says it is there.
 *
 * Nothing in it touches the browser or the engine, so a pause with three reasons, a group member the
 * roster has not named yet and a failed group are unit tests.
 */
import { PAUSE_REASONS, pauseReasons, type PauseReason } from "@magna-carta/mls/pause";
import type { GroupStanding } from "./encryption-group.ts";

export type { PauseReason } from "@magna-carta/mls/pause";

/** Where this browser stands in the key group, as the client holds it. */
export type EncryptionStanding = "off" | "loading" | GroupStanding;

/** What the screen shows about a meeting's encryption. */
export type EncryptionState =
  /** The meeting was opened in the clear. Nothing is drawn about encryption. */
  | { readonly kind: "off" }
  /** The engine is loading or this browser is waiting to be let into the group. */
  | { readonly kind: "connecting" }
  /** Every frame this browser sends and receives is sealed under the group's current key. */
  | { readonly kind: "on" }
  /** A host paused it for a recording, live captions or a phone caller, and the group says so. */
  | { readonly kind: "paused"; readonly reasons: readonly PauseReason[] }
  /** The engine refused something it could not recover from: nothing is sealed or opened here. */
  | { readonly kind: "failed" };

export function encryptionState(facts: {
  readonly encrypted: boolean;
  readonly standing: EncryptionStanding;
  /** The pause bits of the last epoch this browser verified; zero is encrypted. */
  readonly pause: number;
}): EncryptionState {
  if (!facts.encrypted || facts.standing === "off") return { kind: "off" };
  if (facts.standing === "failed") return { kind: "failed" };
  if (facts.standing !== "member") return { kind: "connecting" };
  const reasons = pauseReasons(facts.pause);
  return reasons.length === 0 ? { kind: "on" } : { kind: "paused", reasons };
}

/** What each reason is while it runs, in the order `pauseReasons` names them. */
const REASON_CLAUSES: Record<PauseReason, string> = {
  recording: "this meeting is being recorded",
  captions: "live captions are on",
  phone: "a phone participant is connected",
};

/** What each reason is called where it is named on its own: the Security tab's state line. */
const REASON_WORDS: Record<PauseReason, string> = {
  recording: "Recording",
  captions: "Live captions",
  phone: "Phone participant",
};

/** The reasons a pause holds, named as a short list: "Recording, Live captions". */
export function pauseReasonWords(reasons: readonly PauseReason[]): string {
  return reasons.map((reason) => REASON_WORDS[reason]).join(", ");
}

/**
 * The banner's sentence for a pause: every reason that holds, joined, so a recording with captions
 * on is one sentence rather than two banners.
 */
export function pauseSentence(reasons: readonly PauseReason[]): string {
  const clauses = reasons.map((reason) => REASON_CLAUSES[reason]);
  if (clauses.length === 0) return "";
  const joined =
    clauses.length === 1
      ? clauses[0]
      : `${clauses.slice(0, -1).join(", ")} and ${clauses.at(-1) ?? ""}`;
  return `Not end-to-end encrypted while ${joined}.`;
}

/**
 * The pause bits after a host starts or stops one reason, keeping every other reason that holds.
 * Encryption resumes only when the last reason stops, and the commit that clears it advances the
 * epoch, so the keys that resume are new.
 */
export function pauseBitsWith(current: number, reason: PauseReason, running: boolean): number {
  const bit = PAUSE_REASONS[reason];
  return running ? current | bit : current & ~bit;
}

/**
 * The security code as the panel draws it: its groups of digits, read aloud one group at a time.
 * Empty while this browser is not in the group.
 */
export function securityCodeGroups(code: string | null): readonly string[] {
  if (code === null) return [];
  return code.split(/\s+/u).filter((group) => group.length > 0);
}

/** One member of the key group, as the security panel lists it. */
export interface KeyGroupMember {
  /** The stay the member's credential names. */
  readonly participantId: string;
  /** The name the roster gives that stay, or null where the roster does not hold it (yet). */
  readonly displayName: string | null;
  /** This browser's own leaf. */
  readonly self: boolean;
}

/**
 * Who is in the group, named from the roster where the roster knows the stay, in leaf order so every
 * screen lists the same people in the same order as the code they hash into.
 */
export function keyGroupMembers(
  members: readonly { readonly leafIndex: number; readonly identity: string }[],
  roster: readonly { readonly participantId: string; readonly displayName: string }[],
  ownParticipantId: string | null,
): readonly KeyGroupMember[] {
  const names = new Map(roster.map((row) => [row.participantId, row.displayName]));
  return members
    .toSorted((left, right) => left.leafIndex - right.leafIndex)
    .map((member) => ({
      participantId: member.identity,
      displayName: names.get(member.identity) ?? null,
      self: member.identity === ownParticipantId,
    }));
}
