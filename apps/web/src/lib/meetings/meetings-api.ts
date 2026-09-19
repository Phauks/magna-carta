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
  meetingsJoin,
  meetingsLeave,
  meetingsStart,
  type JoinedMeeting,
  type MeetingAcknowledged,
  type StartedMeeting,
} from "@magna-carta/api-client";
import { failureOf } from "$lib/api/api-client.ts";
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
