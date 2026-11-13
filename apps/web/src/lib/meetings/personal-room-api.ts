/*
 * A member's personal room: the reads and writes the My Room card, the link page and the room's
 * Move to a Matter control make. Each write answers with an outcome rather than throwing, on the
 * terms `meetings-api.ts` sets out, and carries its own idempotency key.
 *
 * A session is an ordinary meeting, so once a member has a meeting to join every act inside it is
 * `meetings-api.ts`'s; these calls only reach the room itself.
 */
import {
  meetingsArriveAtRoom,
  meetingsEnsurePersonalRoom,
  meetingsMoveToMatter,
  meetingsOpenPersonalRoom,
  meetingsReplacePersonalRoomLink,
  meetingsUpdatePersonalRoom,
  type MoveMeetingToMatterResponse,
  type OpenPersonalRoomResponse,
  type PersonalRoomAtLink,
  type PersonalRoomResponse,
} from "@magna-carta/api-client";
import { readerTimeZone } from "$lib/calendar/calendar-api.ts";
import type { MeetingLobbyMode } from "@magna-carta/meeting-protocol/types";
import type { MeetingMedium } from "./meeting-client.svelte.ts";
import { newWriteKey, type MeetingWrite } from "./meetings-api.ts";
import { failureOf } from "$lib/api/api-client.ts";

async function write<T>(call: () => Promise<{ data: T }>): Promise<MeetingWrite<T>> {
  try {
    const { data } = await call();
    return { kind: "ok", value: data };
  } catch (error) {
    return { kind: "failed", failure: failureOf(error) };
  }
}

/** The room's address inside the firm, as a colleague is sent it. */
export function personalRoomAddress(linkCode: string, origin: string): string {
  return `${origin}/meetings/rooms/${linkCode}`;
}

/** Make the caller's room, or answer with it when it exists. */
export function ensurePersonalRoom(): Promise<MeetingWrite<PersonalRoomResponse>> {
  return write(() =>
    meetingsEnsurePersonalRoom({
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/** Change what the caller's room opens its sessions with. */
export function updatePersonalRoom(change: {
  medium?: MeetingMedium;
  lobby?: MeetingLobbyMode;
}): Promise<MeetingWrite<PersonalRoomResponse>> {
  return write(() =>
    meetingsUpdatePersonalRoom({
      body: change,
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/** A new link for the caller's room; the old one stops working. */
export function replacePersonalRoomLink(): Promise<MeetingWrite<PersonalRoomResponse>> {
  return write(() =>
    meetingsReplacePersonalRoomLink({
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/**
 * Open a session in the caller's room, in the zone this browser is in, or answer with the session
 * already in use. The zone is the browser's because the session's event starts now, where the
 * person opening it is.
 */
export function openPersonalRoom(
  matterId: string | null = null,
): Promise<MeetingWrite<OpenPersonalRoomResponse>> {
  return write(() =>
    meetingsOpenPersonalRoom({
      body: { timeZone: readerTimeZone() || "UTC", matterId },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/** Arrive by a room's link: put on the session's event, and handed the meeting to join. */
export function arriveAtRoom(linkCode: string): Promise<MeetingWrite<PersonalRoomAtLink>> {
  return write(() =>
    meetingsArriveAtRoom({
      path: { linkCode },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/** Move a personal-room session onto a matter, during it or after. */
export function moveMeetingToMatter(
  meetingId: string,
  matterId: string,
): Promise<MeetingWrite<MoveMeetingToMatterResponse>> {
  return write(() =>
    meetingsMoveToMatter({
      path: { meetingId },
      body: { matterId },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}
