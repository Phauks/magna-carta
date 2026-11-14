/*
 * What the Connection surface draws, worked out from what the client's diagnostics hold.
 *
 * The same division the tiles are built on: the sheet is presentation and takes records, the
 * diagnostics module is measurement and holds samples, and this is the one place the two are put
 * together — so the sheet renders from a fixed set of numbers under a test or in a gallery with no
 * peer connection anywhere near it.
 *
 * THE ROOM'S OWN VOCABULARY IS TRANSLATED HERE, ONCE. A member never reads `malformed-frame` on a
 * tile or in a sentence about their meeting; on THIS surface they do, because this is the surface
 * whose whole purpose is to be quoted to somebody who can act on it, and dropping the word the room
 * actually used would leave a reader with "something went wrong" and nothing to say next.
 */
import type { EventRailEvent } from "@magna-carta/design-system/event-rail";
import type { ConnectionQuality } from "../client/connection-quality.ts";
import type { DiagnosticEvent, DiagnosticEventKind } from "../client/diagnostics.svelte.ts";
import type { MeetingClient } from "../client/meeting-client.svelte.ts";
import { participantName } from "./meeting-tiles.ts";

/** What this browser is sending, as the last sample found it. */
export interface UplinkModel {
  readonly quality: ConnectionQuality;
  readonly frameWidth: number | null;
  readonly frameHeight: number | null;
  readonly rid: string | null;
  readonly bitsPerSecond: number | null;
  readonly lossFraction: number | null;
  readonly roundTripMilliseconds: number | null;
}

/** One other person in the room, as the Connection surface draws them. */
export interface ConnectionParticipantModel {
  readonly participantId: string;
  readonly name: string;
  readonly quality: ConnectionQuality;
}

/** Nothing measured yet, which is what a meeting's first five seconds honestly look like. */
const NOTHING_MEASURED: UplinkModel = {
  quality: "unknown",
  frameWidth: null,
  frameHeight: null,
  rid: null,
  bitsPerSecond: null,
  lossFraction: null,
  roundTripMilliseconds: null,
};

/** What this browser is sending, for the sheet's own definition list. */
export function connectionUplink(client: MeetingClient): UplinkModel {
  const sample = client.diagnostics.latest;
  if (sample === null) return { ...NOTHING_MEASURED, quality: client.diagnostics.quality };
  const uplink = sample.uplink;
  return {
    quality: client.diagnostics.quality,
    frameWidth: uplink?.frameWidth ?? null,
    frameHeight: uplink?.frameHeight ?? null,
    rid: uplink?.rid ?? null,
    bitsPerSecond: uplink?.bitsPerSecond ?? null,
    lossFraction: uplink?.lossFraction ?? null,
    roundTripMilliseconds: sample.roundTripMilliseconds,
  };
}

/** Everybody else in the room, in the order the roster names them. */
export function connectionParticipants(client: MeetingClient): ConnectionParticipantModel[] {
  return client.others.map((participant) => ({
    participantId: participant.participantId,
    name: participantName(participant),
    quality: client.qualityOf(participant.participantId),
  }));
}

/**
 * What each kind of event is called, in the reader's words rather than the wire's.
 *
 * A record rather than a switch, so the compiler holds it complete: a kind added to the ring with
 * no sentence here is a type error rather than a blank line in the list somebody reads while a
 * meeting is going wrong.
 */
const STATEMENT: Record<DiagnosticEventKind, (detail: string | null) => string> = {
  join: () => "Opened the connection to the room",
  welcome: () => "The room said hello",
  publish: () => "Offered what this page is sending",
  subscribe: (detail) =>
    detail === null ? "Asked the room for what is on screen" : `Asked the room for ${detail}`,
  subscribed: (detail) =>
    detail === null ? "The room answered" : `The room answered with ${detail}`,
  layer: (detail) =>
    detail === null
      ? "Asked for a different picture size"
      : `Asked for a different picture size for ${detail}`,
  refused: (detail) =>
    detail === null ? "The room refused something" : `The room refused something: ${detail}`,
  superseded: () => "This meeting was taken over by another tab or window",
  "socket-lost": (detail) =>
    detail === null
      ? "The connection to the room went away"
      : `The connection to the room went away: ${detail}`,
  ended: () => "The meeting ended",
  "protocol-mismatch": (detail) =>
    detail === null
      ? "This page and the room disagree about how to talk"
      : `The room is speaking ${detail}, which this page does not`,
  picture: (detail) =>
    detail === null ? "A tile started a new picture" : `A tile started a new picture (${detail})`,
  "camera-track": (detail) =>
    detail === null
      ? "Your camera's picture was replaced"
      : `Your camera's picture was replaced (${detail})`,
  view: (detail) => (detail === null ? "The view changed" : `The view changed: ${detail}`),
};

/**
 * Which end of the wire an event came from.
 *
 * The rail asks what CAUSED an event, and for a connection the honest answer is one of two things
 * and never a person: this page did it, or the room did. A name would be wrong in both directions.
 */
function sourceOf(event: DiagnosticEvent): string {
  switch (event.kind) {
    case "welcome":
    case "subscribed":
    case "refused":
    case "superseded":
    case "ended":
    case "protocol-mismatch":
      return "The room";
    default:
      return "This page";
  }
}

/**
 * What has happened on the wire, oldest first, for the rail to draw.
 *
 * The Error ID rides as the event's detail because that is what it is: the handle recorded
 * alongside what happened, and the one thing worth quoting to whoever reads the other end of it.
 */
export function connectionEvents(events: readonly DiagnosticEvent[]): EventRailEvent[] {
  return events.map((event, position) => ({
    // The instant alone is not unique — a refusal and the socket closing under it land in the same
    // millisecond — so the position carries the identity the rail keys its rows on.
    id: `${position}-${event.at}-${event.kind}`,
    action: STATEMENT[event.kind](event.detail),
    at: event.at,
    source: sourceOf(event),
    ...(event.errorId === null ? {} : { detail: `Error ID ${event.errorId}` }),
  }));
}
