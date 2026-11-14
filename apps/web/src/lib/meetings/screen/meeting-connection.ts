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
import type { ConnectionQuality, MediaServer } from "../client/connection-quality.ts";
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
  /** Everything the connection sends and receives, all streams together, in bits per second. */
  readonly uploadBitsPerSecond: number | null;
  readonly downloadBitsPerSecond: number | null;
  /** The media server the connection is carried by. */
  readonly server: MediaServer | null;
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
  uploadBitsPerSecond: null,
  downloadBitsPerSecond: null,
  server: null,
};

/** What a camera size is called on screen. The room's own names for them are one letter. */
export const CAMERA_LAYER_WORDS: Record<string, string> = {
  f: "Full size",
  h: "Half size",
  q: "Quarter size",
};

/**
 * The Cloudflare site serving this page, by its code (named for the nearest airport, such as SJC),
 * read from the platform's own trace address. Null where the page is not served through Cloudflare
 * (a developer's machine) or the read fails. The media server is reached through the same network,
 * so this is the site the meeting runs through as well.
 */
export async function readCloudflareSite(
  fetcher: typeof fetch = globalThis.fetch,
): Promise<string | null> {
  try {
    const response = await fetcher("/cdn-cgi/trace", { credentials: "omit" });
    if (!response.ok) return null;
    const line = (await response.text()).split("\n").find((entry) => entry.startsWith("colo="));
    const site = line?.slice("colo=".length).trim() ?? "";
    return /^[A-Z]{3}$/.test(site) ? site : null;
  } catch {
    return null;
  }
}

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
    uploadBitsPerSecond: sample.uploadBitsPerSecond ?? null,
    downloadBitsPerSecond: sample.downloadBitsPerSecond ?? null,
    server: sample.server ?? null,
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
