/*
 * The four writes a meeting screen makes, each answering with an outcome rather than throwing.
 *
 * The reads are the generated `…Options` factories and go straight into the one cache; these are
 * the writes, and they are wrapped for one reason: the generated client throws its failure
 * (api-client.ts says why), and a surface in the middle of a meeting has to RENDER a refusal rather
 * than unwind. So each call comes back as a value or as the `Failure` record every failure surface
 * in the app is built on, and nothing above here touches an exception.
 *
 * EVERY WRITE CARRIES ITS OWN IDEMPOTENCY KEY. The routes require one, and the reason is the retry:
 * a join that is sent twice must open one attendance row, not two, or the room's own cap counts a
 * member twice and the record says they were in the room twice over.
 */
import {
  meetingsEnd,
  meetingsGrantHosting,
  meetingsHosts,
  meetingsJoin,
  meetingsLeave,
  meetingsRemoveParticipant,
  meetingsRevokeHosting,
  meetingsSetLocked,
  meetingsStart,
  type JoinedMeeting,
  type MeetingAcknowledged,
  type MeetingHostGrant,
  type MeetingHostingAcknowledged,
  type StartedMeeting,
} from "@magna-carta/api-client";
import { failureOf } from "$lib/api/api-client.ts";
import type { MeetingHostRole } from "@magna-carta/meeting-protocol/types";
import type { MeetingMedium } from "./meeting-client.svelte.ts";
import type { Failure } from "$lib/api/problem.ts";

/** What a write answered: the value, or the record a failure surface renders from. */
export type MeetingWrite<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "failed"; readonly failure: Failure };

/** A fresh idempotency key per submitted write, so a retry of THAT write is the same write. */
export function newWriteKey(): string {
  return crypto.randomUUID();
}

async function write<T>(call: () => Promise<{ data: T }>): Promise<MeetingWrite<T>> {
  try {
    const { data } = await call();
    return { kind: "ok", value: data };
  } catch (error) {
    return { kind: "failed", failure: failureOf(error) };
  }
}

/**
 * Create the event's meeting, or answer with the one it already has.
 *
 * The route is idempotent on the event rather than on the key alone, so two members pressing Start
 * within a second of each other land in the same room instead of opening two — which is also why
 * the SECOND of them gets the room the first opened, in the medium the first chose.
 */
export function startMeeting(
  eventKind: "matter" | "firm",
  eventId: string,
  medium: MeetingMedium = "video",
): Promise<MeetingWrite<StartedMeeting>> {
  return write(() =>
    meetingsStart({
      // What the room carries is settled HERE and never again: everybody who joins agreed to the
      // same thing, so the medium is part of opening the room rather than a setting inside it.
      body: { eventKind, eventId, medium },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/** Open this member's attendance and answer with who they are in the room and how to reach it. */
export function joinMeeting(meetingId: string): Promise<MeetingWrite<JoinedMeeting>> {
  return write(() =>
    meetingsJoin({
      path: { meetingId },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/**
 * Close this member's attendance.
 *
 * The socket closing does NOT do this, by design on the server: a dropped connection is not a
 * member leaving the room, and an attendance row that closed itself on a blip would report somebody
 * as having left a meeting they were still in. So leaving is its own act, and the screen makes it
 * on the way out as well as on the control.
 */
export function leaveMeeting(meetingId: string): Promise<MeetingWrite<MeetingAcknowledged>> {
  return write(() =>
    meetingsLeave({
      path: { meetingId },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/** End it for everybody. The room broadcasts `ended` and closes every socket. */
export function endMeeting(meetingId: string): Promise<MeetingWrite<MeetingAcknowledged>> {
  return write(() =>
    meetingsEnd({
      path: { meetingId },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/*
 * RUNNING THE MEETING: the acts somebody could later ask "who did that" about.
 *
 * They are routes rather than frames for that one reason. A member was put out of a meeting that is
 * on a matter's record; arrivals were refused at a door somebody closed; the room changed hands. Each
 * of those outlives the room, and the only honest answer to who did it is a row written at the moment
 * it happened. The acts that leave nothing behind — a mute, a spotlight, a tap on the shoulder — go
 * out as frames on the socket instead (client/host-controls.ts says why at length).
 */

/** Who is running this meeting, as the record states it. Everybody in the room may ask. */
export function readMeetingHosts(
  meetingId: string,
): Promise<MeetingWrite<readonly MeetingHostGrant[]>> {
  return write(async () => {
    const { data } = await meetingsHosts({ path: { meetingId }, throwOnError: true });
    return { data: data.data };
  });
}

/**
 * Write a grant: hand the meeting over, name a co-host, or CLAIM a room nobody is running.
 *
 * One route, because they are one act with different arguments — writing a grant — and four would be
 * four places for the same invariants to drift. Naming yourself with the host's role is the claim,
 * and it is refused while anybody hosting the room still has an open stay.
 */
export function grantMeetingHosting(
  meetingId: string,
  userId: string,
  role: MeetingHostRole,
): Promise<MeetingWrite<readonly MeetingHostGrant[]>> {
  return write(async () => {
    const { data } = await meetingsGrantHosting({
      path: { meetingId },
      body: { userId, role },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    });
    return { data: data.data };
  });
}

/** Withdraw a co-host's grant. The host's own is handed over rather than withdrawn. */
export function revokeMeetingHosting(
  meetingId: string,
  userId: string,
): Promise<MeetingWrite<readonly MeetingHostGrant[]>> {
  return write(async () => {
    const { data } = await meetingsRevokeHosting({
      path: { meetingId, userId },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    });
    return { data: data.data };
  });
}

/**
 * Put somebody out of the room.
 *
 * Addressed by the STAY rather than by the member: that is what the roster carries and what every
 * frame on the wire names, and a member handle would not distinguish two stays. They are barred from
 * this meeting while it runs, and from nothing else.
 */
export function removeMeetingParticipant(
  meetingId: string,
  participantId: string,
): Promise<MeetingWrite<MeetingHostingAcknowledged>> {
  return write(() =>
    meetingsRemoveParticipant({
      path: { meetingId, participantId },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/** Shut the door, or open it again. A locked room refuses arrivals and touches nobody in it. */
export function setMeetingLocked(
  meetingId: string,
  locked: boolean,
): Promise<MeetingWrite<MeetingHostingAcknowledged>> {
  return write(() =>
    meetingsSetLocked({
      path: { meetingId },
      body: { locked },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/**
 * The problem-type URI a slug names, which is how a screen branches on WHICH refusal it got.
 *
 * The server emits the registered URI rather than the bare slug, and a screen comparing the two
 * silently never matches — so the one place the prefix is written down is here, beside the calls
 * whose refusals are read.
 */
export function meetingProblemType(slug: string): string {
  return `https://api.magnacarta.esq/problems/${slug}`;
}

/** Whether a failure is the named refusal, rather than some other way the same call can fail. */
export function refusedAs(failure: Failure | null, slug: string): boolean {
  return failure?.problem?.type === meetingProblemType(slug);
}

/** Where the event this meeting hangs on is read: the calendar, with the entry's window open. */
export function eventAddress(
  eventKind: "matter" | "firm",
  eventId: string,
  matterId: string | null,
): string {
  const entry = `entry=${encodeURIComponent(eventId)}`;
  if (eventKind === "matter" && matterId !== null) {
    return `/matters/${encodeURIComponent(matterId)}/calendar?${entry}`;
  }
  return `/calendar?${entry}`;
}
