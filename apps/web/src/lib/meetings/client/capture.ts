/*
 * What this browser captures, and how it is offered to the unit.
 *
 * THE CAMERA IS NOT CAPTURED IN A CALL, rather than captured and muted. A browser that opens a
 * camera lights the device's own indicator, and a member who started a call did not agree to that;
 * the room would refuse the picture anyway (`track-kind-refused`), so asking for it would be a light
 * on somebody's laptop in exchange for nothing.
 *
 * THE MICROPHONE AND CAMERA ARE CAPTURED BY THE CLIENT ITSELF, through the constraint builder and the
 * effects stage in media-effects.ts, because what the stage hands back is what everything downstream
 * treats as "the local stream". This module keeps the screen capture and the offering of tracks.
 */
import type { MeetingTrackKind } from "./signaling.ts";

/**
 * The layers a camera is published in: full, half and quarter of the captured resolution.
 *
 * A room of three hundred draws its tiles small, and a subscriber that could only ever be sent the
 * full picture would be decoding sixteen full-resolution streams to paint sixteen thumbnails. The
 * unit cannot make a small picture out of a large one, so the publisher sends all three and each
 * subscriber names the one its tiles are worth. A fresh array per call: the browser takes ownership
 * of what it is handed.
 */
function cameraSimulcastEncodings(): RTCRtpEncodingParameters[] {
  return [
    // The ceilings keep the three together under about 1.7 Mbit/s. Left to itself Chrome sends the
    // full size alone at around 2.5 Mbit/s, which is more than a 720p face needs and more than many
    // home uploads carry comfortably beside everything else on the line.
    { rid: "f", scaleResolutionDownBy: 1, maxBitrate: 1_200_000 },
    { rid: "h", scaleResolutionDownBy: 2, maxBitrate: 350_000 },
    { rid: "q", scaleResolutionDownBy: 4, maxBitrate: 120_000 },
  ];
}

/** The seams capture reaches the browser through. A subset of the client's own. */
export interface CaptureSeams {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  getDisplayMedia: (constraints: DisplayMediaStreamOptions) => Promise<MediaStream>;
}

/** One local track on the connection, and what the room will be told it carries. */
export interface OfferedTrack {
  readonly transceiver: RTCRtpTransceiver;
  readonly kind: MeetingTrackKind;
}

/**
 * Capture a screen or a window. Null where the member cancelled the picker, or where what came back
 * carries no picture at all — in which case whatever DID come back is stopped rather than left
 * running behind a control that says nothing is being shared.
 */
export async function captureScreenShare(seams: CaptureSeams): Promise<MediaStream | null> {
  let stream: MediaStream;
  try {
    stream = await seams.getDisplayMedia({ video: true });
  } catch {
    return null;
  }
  const [track] = stream.getVideoTracks();
  if (track === undefined) {
    for (const spare of stream.getTracks()) spare.stop();
    return null;
  }
  return stream;
}

/**
 * Put the captured tracks on the connection, in the shapes the unit is told to expect.
 *
 * The camera goes up in three layers and the microphone in one. Sound has no resolution to step
 * down, and a screen share is offered below as a single layer, because a quarter-resolution document
 * is a document nobody can read.
 */
export function offerCapturedTracks(
  peerConnection: RTCPeerConnection,
  stream: MediaStream,
  wantsPicture: boolean,
): OfferedTrack[] {
  const offered: OfferedTrack[] = [];
  for (const track of stream.getTracks()) {
    // A call offers sound and nothing else. Capture asked for no picture, so this is the second
    // gate rather than the first: a browser that handed back a video track anyway does not get
    // to publish it into a room whose people agreed to a call.
    if (!wantsPicture && track.kind !== "audio") continue;
    const transceiver = peerConnection.addTransceiver(track, {
      direction: "sendonly",
      ...(track.kind === "video" ? { sendEncodings: cameraSimulcastEncodings() } : {}),
    });
    offered.push({ transceiver, kind: track.kind === "audio" ? "audio" : "video" });
  }
  return offered;
}

/**
 * Put the microphone on the connection AGAIN, after a host closed it upstream.
 *
 * A HOST'S MUTE GENUINELY TAKES THE TRACK AWAY. The room closes it at the routing service, which is
 * what makes a mute a mute rather than a request the browser could decline by ignoring it — so
 * un-muting afterwards cannot be a flipped `enabled` flag on a track nothing is carrying any more.
 * It is a fresh offer and a fresh `publish` naming the section the sound goes up.
 *
 * THE SECTION IS REUSED, NOT ADDED, and that is the whole of this function. A meeting where a host
 * mutes the room every few minutes is a meeting where a member is muted and comes back many times,
 * and a `addTransceiver` per return grows the session description by a media section each time —
 * unbounded, for the length of the meeting, with every renegotiation after it carrying the whole
 * accumulated list. The mid is also what every later frame ADDRESSES the sound by (a `close` names
 * mids), so a stable one is what keeps this browser and the room talking about the same thing. The
 * old section is already closed AT THE FAR END by the mute itself — the room did that, which is
 * what made it a mute — so nothing here asks the room to close it a second time.
 *
 * `mid` is the section the microphone last went up. Null before anything has been published, or
 * where the browser never reported one, and then there is nothing to reuse and a section is added.
 *
 * The device's own track is untouched by any of that: the close happened at the far end, so what
 * goes back up is the microphone the member has had open all along, and nothing asks them for
 * permission a second time. One layer, because sound has no resolution to step down.
 */
export async function offerMicrophoneTrack(
  peerConnection: RTCPeerConnection,
  track: MediaStreamTrack,
  mid: string | null = null,
): Promise<RTCRtpTransceiver> {
  const held =
    mid === null
      ? undefined
      : peerConnection.getTransceivers().find((candidate) => candidate.mid === mid);
  if (held === undefined) {
    return peerConnection.addTransceiver(track, { direction: "sendonly" });
  }
  // The sender keeps its place in the description; what changes is what it is carrying and that it
  // is carrying anything at all. `replaceTrack` is the one way to do that without renegotiating a
  // section, which is exactly what reusing it is for.
  await held.sender.replaceTrack(track);
  held.direction = "sendonly";
  return held;
}

/** Put a screen share on the connection: one video track, one layer. */
export function offerScreenTrack(
  peerConnection: RTCPeerConnection,
  track: MediaStreamTrack,
): RTCRtpTransceiver {
  return peerConnection.addTransceiver(track, { direction: "sendonly" });
}
