/*
 * Everything somebody from outside the firm asks of a meeting, and everything a host asks about them.
 *
 * TWO LANES, AND THEY NEVER MIX. The first four calls are the GUEST'S: they carry the link's token or
 * the grant an arrival was answered with, in the guest header, and never a session — the page they
 * are made from is served from the firm's own origin and must be structurally unable to reach the
 * application, so every one of them sends no cookie at all. The last four are the HOST'S, on the
 * ordinary member routes, and they are here rather than in `meetings-api.ts` only because they are
 * about the same people.
 *
 * EVERY CALL ANSWERS WITH AN OUTCOME, on the same terms `meetings-api.ts` gives: a screen at a door
 * has to RENDER a refusal rather than unwind, so each call comes back as a value or as the `Failure`
 * every failure surface renders from.
 *
 * OPENING THE LINK SPENDS NOTHING. The summary is a read that writes nothing, so a mail client that
 * prefetches the link, a scanner that follows every address in a message and a person who clicks
 * twice all cost nothing. What spends the token is pressing Join, which is the one POST here a
 * prefetcher never makes.
 */
import {
  guestArrive,
  guestDepart,
  guestListMessages,
  guestMeetingSummary,
  guestSendMessage,
  meetingsInviteGuest,
  meetingsListGuests,
  meetingsRevokeGuestLink,
  meetingsRotateGuestLink,
  type GuestArrival,
  type GuestMeetingSummary,
  type MeetingGuestInvitation,
  type MeetingMessage,
  type MeetingMessagePage,
} from "@magna-carta/api-client";
import { failureOf } from "$lib/api/api-client.ts";
import { leaveMeetingAsGuestOnDeparture, MEETING_GUEST_HEADER } from "$lib/api/departure-write.ts";
import { guestMeetingSocketUrl } from "$lib/api/socket-url.ts";
import { meetingProblemType, newWriteKey, type MeetingWrite } from "./meetings-api.ts";
import type { Failure } from "$lib/api/problem.ts";
import type { MeetingChatSeams } from "./client/chat.svelte.ts";

export { guestMeetingSocketUrl, leaveMeetingAsGuestOnDeparture };

/*
 * The three shapes these calls answer with, as the contract states them.
 *
 * `GuestMeetingSummary` is a DISTINCT shape from a member's summary rather than the same one with
 * fields left empty: a field left empty is a field somebody later fills, and the matter and the event
 * behind a meeting must never be reachable from a guest's page. `GuestArrival` is the member join's
 * shape plus the grant, which is what lets the room client take it unchanged. `MeetingGuestInvitation`
 * is what a host reads about a link, and carries no part of the token.
 */
export type { GuestArrival, GuestMeetingSummary, MeetingGuestInvitation };

/**
 * The most characters a name given at the door holds.
 *
 * The browser's mirror of the number the arrival is checked against, stated here because the field
 * has to stop taking characters before anybody presses anything; a name that got past this would be
 * refused rather than stored.
 */
export const MAX_GUEST_NAME_LENGTH = 80;

/**
 * A name as the door takes it: every run of white space one space, nothing at either end, and no
 * longer than the door holds.
 *
 * The name is untrusted display text that a host reads before deciding who to let in, so spacing a
 * look-alike apart or padding it out to push the real name off a row must not survive the trip.
 */
export function normalizeGuestName(typed: string): string {
  return typed.replace(/\s+/gu, " ").trim().slice(0, MAX_GUEST_NAME_LENGTH);
}

/** The header a guest call carries its credential in: the link's token, or the arrival's grant. */
function guestHeader(credential: string): { [MEETING_GUEST_HEADER]: string } {
  return { [MEETING_GUEST_HEADER]: credential };
}

async function outcomeOf<T>(call: () => Promise<{ data: T }>): Promise<MeetingWrite<T>> {
  try {
    const { data } = await call();
    return { kind: "ok", value: data };
  } catch (error) {
    return { kind: "failed", failure: failureOf(error) };
  }
}

/** The meeting a link opens onto. Reads; spends nothing and writes nothing. */
export function readGuestMeeting(token: string): Promise<MeetingWrite<GuestMeetingSummary>> {
  return outcomeOf(() =>
    guestMeetingSummary({ headers: guestHeader(token), credentials: "omit", throwOnError: true }),
  );
}

/**
 * Press Join: spend the link, open a stay at the door under the name given there, and answer with
 * the grant the rest of the visit rides on.
 *
 * An arrival while this link already holds an open stay answers with THAT stay and a fresh grant,
 * rather than opening a second — so a guest whose laptop slept presses Join again and is back where
 * they were, and a second browser on the same link takes the first one's place rather than joining
 * beside it.
 */
export function arriveAsGuest(
  token: string,
  confirmedName: string,
): Promise<MeetingWrite<GuestArrival>> {
  return outcomeOf(() =>
    guestArrive({
      headers: guestHeader(token),
      body: { confirmedName: normalizeGuestName(confirmedName) },
      credentials: "omit",
      throwOnError: true,
    }),
  );
}

/**
 * Close this guest's own stay, the way a member's Leave does.
 *
 * It is its own act for the reason a member's is: a socket that drops is not somebody leaving, so
 * the record would otherwise hold a guest in the room until the server's sweep noticed.
 */
export function leaveMeetingAsGuest(grant: string): Promise<MeetingWrite<unknown>> {
  return outcomeOf(() =>
    guestDepart({
      headers: { ...guestHeader(grant), "idempotency-key": newWriteKey() },
      credentials: "omit",
      throwOnError: true,
    }),
  );
}

/*
 * WHAT A GUEST SAYS IN THE ROOM. The same transcript a member reads, on the guest's own two routes
 * and carrying the grant, so the chat client the member's screen uses runs here unchanged. A guest
 * has no way to take a line back — that is a member's act on their own words and a host's on the
 * room's — so the third seam is never reached: the screen offers no control that calls it.
 */

/** The chat client's seams for a guest, over whichever grant this browser currently holds. */
export function guestChatSeams(grant: () => string | null): MeetingChatSeams {
  const withGrant = <T>(call: (held: string) => Promise<MeetingWrite<T>>) => {
    const held = grant();
    return held === null
      ? Promise.resolve<MeetingWrite<T>>({
          kind: "failed",
          failure: { problem: null, request: "", failedAt: new Date() },
        })
      : call(held);
  };
  return {
    list: (cursor) =>
      withGrant((held) =>
        outcomeOf<MeetingMessagePage>(() =>
          guestListMessages({
            headers: guestHeader(held),
            credentials: "omit",
            throwOnError: true,
            ...(cursor === null ? {} : { query: { cursor } }),
          }),
        ),
      ),
    send: (body) =>
      withGrant((held) =>
        outcomeOf<MeetingMessage>(() =>
          guestSendMessage({
            headers: { ...guestHeader(held), "idempotency-key": newWriteKey() },
            body: { body },
            credentials: "omit",
            throwOnError: true,
          }),
        ),
      ),
    redact: () =>
      Promise.resolve({
        kind: "failed",
        failure: { problem: null, request: "", failedAt: new Date() },
      }),
    every: (milliseconds, tick) => {
      const ticking = setInterval(tick, milliseconds);
      return () => clearInterval(ticking);
    },
  };
}

/*
 * THE HOST'S FOUR. Each is a route rather than a frame for the reason every hosting act is: who was
 * sent a way into a meeting on a matter's record, and who took it away, are facts somebody will
 * later ask about.
 */

/** Every invitation on this meeting, withdrawn ones included, with no token anywhere in it. */
export function readMeetingGuests(
  meetingId: string,
): Promise<MeetingWrite<readonly MeetingGuestInvitation[]>> {
  return outcomeOf(async () => {
    const { data } = await meetingsListGuests({ path: { meetingId }, throwOnError: true });
    return { data: data.data };
  });
}

/**
 * Send a link to a person or an organization on the event.
 *
 * A second invitation for the same person REPLACES the first rather than standing beside it: two
 * live links for one guest are two withdrawals to remember, and one of them is always forgotten.
 */
export function inviteMeetingGuest(
  meetingId: string,
  entityId: string,
): Promise<MeetingWrite<MeetingGuestInvitation>> {
  return outcomeOf(() =>
    meetingsInviteGuest({
      path: { meetingId },
      body: { entityId },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/**
 * Send a new link in place of the old one. The old one stops working at once, and anybody in the
 * room on it is taken out at their next request — which is the answer to a link forwarded by mistake.
 */
export function rotateMeetingGuestLink(
  meetingId: string,
  invitationId: string,
): Promise<MeetingWrite<MeetingGuestInvitation>> {
  return outcomeOf(() =>
    meetingsRotateGuestLink({
      path: { meetingId, invitationId },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/**
 * Withdraw a link. The invitation is kept, marked withdrawn: that somebody was invited and then was
 * not is part of what the record says happened, and deleting it would make a withdrawn invitation
 * look like one that was never sent.
 */
export function revokeMeetingGuestLink(
  meetingId: string,
  invitationId: string,
): Promise<MeetingWrite<MeetingGuestInvitation>> {
  return outcomeOf(() =>
    meetingsRevokeGuestLink({
      path: { meetingId, invitationId },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/*
 * WHAT A REFUSED LINK SAYS.
 *
 * THE LINE IS DRAWN AT THE SIGNATURE. A token whose signature does not verify gets one flat answer
 * that says nothing at all, because somebody guessing at the route must not learn whether a meeting
 * or a firm exists. A token that verifies but cannot be used — expired, withdrawn, replaced, used up,
 * or on a meeting that has ended — gets a sentence the person can act on, because the only person who
 * can present a correctly signed token is somebody the firm sent one to, and they already know
 * everything the sentence tells them.
 */

/** What a person reads about a link that cannot be used, and whether trying again could help. */
export interface GuestRefusal {
  readonly title: string;
  readonly sentence: string;
  /** Whether pressing Join again later could work — a locked room opens again; an expired link does not. */
  readonly retryable: boolean;
}

/** The one answer for a link that is not a link: nothing about what it might have been. */
export const UNUSABLE_LINK: GuestRefusal = {
  title: "This Link Cannot Be Used",
  sentence: "This link does not open anything.",
  retryable: false,
};

const ASK_FOR_A_NEW_LINK = "Ask the firm for a new link.";

/** The refusals a guest can be given a sentence for, by the problem each is sent as. */
export type GuestRefusalSlug =
  | "guest-link-expired"
  | "guest-link-revoked"
  | "guest-link-not-valid"
  | "guest-link-exhausted"
  | "meeting-ended"
  | "meeting-locked"
  | "meeting-lobby-full"
  | "meeting-removed"
  | "meeting-not-admitted";

/** The link's own refusals, by the problem each is sent as. */
const REFUSALS: ReadonlyMap<GuestRefusalSlug, GuestRefusal> = new Map<
  GuestRefusalSlug,
  GuestRefusal
>([
  [
    "guest-link-expired",
    {
      title: "This Link Has Expired",
      sentence: `This link was only good until shortly after the meeting. ${ASK_FOR_A_NEW_LINK}`,
      retryable: false,
    },
  ],
  [
    "guest-link-revoked",
    {
      title: "This Link Was Withdrawn",
      sentence: `The firm has withdrawn this link or sent a newer one in its place. ${ASK_FOR_A_NEW_LINK}`,
      retryable: false,
    },
  ],
  [
    "guest-link-not-valid",
    {
      title: "This Link No Longer Works",
      sentence: `This link has been replaced and no longer opens the meeting. ${ASK_FOR_A_NEW_LINK}`,
      retryable: false,
    },
  ],
  [
    "guest-link-exhausted",
    {
      title: "This Link Has Been Used Up",
      sentence: `This link has been used to join as many times as it can be. ${ASK_FOR_A_NEW_LINK}`,
      retryable: false,
    },
  ],
  [
    "meeting-ended",
    {
      title: "This Meeting Has Ended",
      sentence: `The meeting this link was for is over. If you expected to be in it, ${ASK_FOR_A_NEW_LINK.toLowerCase()}`,
      retryable: false,
    },
  ],
  [
    "meeting-locked",
    {
      title: "This Meeting Is Locked",
      // The same words a member's Join control says for the same state, and the link is not spent:
      // the host may open the room again, and the guest can simply press Join once they have.
      sentence:
        "A host has locked this meeting, so nobody else can come in. Your link still works, so you can try again once the host opens it.",
      retryable: true,
    },
  ],
  [
    "meeting-lobby-full",
    {
      title: "Too Many People Are Waiting",
      sentence:
        "Too many people are already waiting to be let into this meeting. Your link still works, so you can try again in a few minutes.",
      retryable: true,
    },
  ],
  [
    "meeting-removed",
    {
      title: "You Were Removed From This Meeting",
      sentence: `A host took you out of this meeting, so this link cannot bring you back into it. ${ASK_FOR_A_NEW_LINK}`,
      retryable: false,
    },
  ],
  [
    "meeting-not-admitted",
    {
      title: "You Were Not Let Into This Meeting",
      sentence: `A host did not let you into this meeting, so this link cannot bring you back to its door. ${ASK_FOR_A_NEW_LINK}`,
      retryable: false,
    },
  ],
]);

/**
 * The sentence for one refusal, where the room rather than a call is what said it — a host turning
 * somebody away at the door, or taking them out of the room, arrives as a frame on the socket and
 * reads exactly as the same refusal does when the link is pressed again afterwards.
 */
export function guestRefusalNamed(slug: GuestRefusalSlug): GuestRefusal {
  return REFUSALS.get(slug) ?? UNUSABLE_LINK;
}

/**
 * What a refused guest call says, or null where it was not the link that was refused at all — a
 * server fault or a dropped connection, which the ordinary failure surface states with its Error ID.
 *
 * A refusal carrying none of the link's own problems is the FLAT one: the lane answers a token whose
 * signature did not verify exactly as it answers an address that does not exist, and so does this.
 */
export function guestRefusalOf(failure: Failure): GuestRefusal | null {
  const problem = failure.problem;
  if (problem === null) return null;
  for (const [slug, refusal] of REFUSALS) {
    if (problem.type === meetingProblemType(slug)) return refusal;
  }
  if (problem.status === 404 || problem.status === 401 || problem.status === 403) {
    return UNUSABLE_LINK;
  }
  return null;
}
