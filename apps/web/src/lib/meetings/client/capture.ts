/*
 * What this browser captures, and how it is offered to the unit.
 *
 * THE CAMERA IS NOT CAPTURED IN A CALL, rather than captured and muted. A browser that opens a
 * camera lights the device's own indicator, and a member who started a call did not agree to that;
 * the room would refuse the picture anyway (`track-kind-refused`), so asking for it would be a light
 * on somebody's laptop in exchange for nothing.
 *
 * EVERY CAPTURE PASSES THROUGH THE EFFECTS STAGE, which is the identity today. The stage is here
 * rather than added later because what it hands back is what everything downstream treats as "the
 * local stream" — see media-effects.ts for the two decisions that would otherwise be made wrong.
 */
import type { MeetingMedium } from "@magna-carta/meeting-protocol/types";
import {
  NO_EFFECTS,
  passThroughEffects,
  type EffectedCapture,
  type MediaEffectsStage,
} from "./media-effects.ts";
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
    { rid: "f", scaleResolutionDownBy: 1 },
    { rid: "h", scaleResolutionDownBy: 2 },
    { rid: "q", scaleResolutionDownBy: 4 },
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

/** The browser's own effects stage. One place, so a later slice swaps it in one place. */
export function meetingEffectsStage(): MediaEffectsStage {
  return passThroughEffects();
}

/**
 * Capture what this room carries — the microphone and camera in a meeting, the microphone alone in
 * a call — and put it through the effects stage.
 *
 * Null where the browser would not give it: a member who declined the camera is still in the room
 * and can still see and hear everybody else, so the refusal is the caller's to state, not a throw.
 */
export async function captureLocalMedia(
  seams: CaptureSeams,
  medium: MeetingMedium,
  effects: MediaEffectsStage = meetingEffectsStage(),
): Promise<EffectedCapture | null> {
  let captured: MediaStream;
  try {
    captured = await seams.getUserMedia({ audio: true, video: medium === "video" });
  } catch {
    return null;
  }
  return await effects.applyEffects(captured, NO_EFFECTS);
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

/** Put a screen share on the connection: one video track, one layer. */
export function offerScreenTrack(
  peerConnection: RTCPeerConnection,
  track: MediaStreamTrack,
): RTCRtpTransceiver {
  return peerConnection.addTransceiver(track, { direction: "sendonly" });
}
