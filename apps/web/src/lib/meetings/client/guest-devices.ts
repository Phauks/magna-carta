/*
 * Which microphone and camera somebody arriving from outside the firm chose, and how that choice
 * reaches the capture the room client makes later.
 *
 * A GUEST CHECKS THEIR DEVICES BEFORE THEY KNOCK. A member walks into a room from a screen they use
 * every day; a guest arrives from an e-mail on a machine nobody at the firm has seen, and learning
 * that the microphone is muted in hardware is cheap at the door and expensive in front of a room.
 * So the arrival page captures a preview, lists what the browser offers, and meters the microphone —
 * all before anything is joined, and all of it let go the moment Join is pressed, because nothing
 * is captured while somebody waits at a door.
 *
 * THE CHOICE REACHES THE ROOM THROUGH THE CLIENT'S OWN SEAM. The room client captures through
 * `getUserMedia` on `MeetingClientSeams` and knows nothing of a device picker; wrapping that one
 * seam with the chosen devices is what lets the client stay exactly as it is.
 *
 * Nothing in this module touches `navigator`: the browser's own seams are built in one function, so
 * a test hands in fakes and the arrival runs under it with no device anywhere near it.
 */
import { createBrowserAudioLevelMeter, type AudioLevelMeter } from "./audio-level-meter.ts";
import type { MeetingMedium } from "@magna-carta/meeting-protocol/types";

/** The devices somebody chose at the door. Null is "whichever the browser offers first". */
export interface GuestDeviceChoice {
  readonly microphoneId: string | null;
  readonly cameraId: string | null;
}

/** One device the browser offers, in the words a picker shows. */
export interface GuestDeviceOption {
  readonly deviceId: string;
  readonly label: string;
}

/** The edges the device check reaches the browser through. */
export interface GuestDeviceSeams {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  enumerateDevices: () => Promise<readonly MediaDeviceInfo[]>;
  createAudioLevelMeter: (track: MediaStreamTrack) => AudioLevelMeter;
}

/** The seams as a real browser supplies them. */
export function browserGuestDeviceSeams(): GuestDeviceSeams {
  return {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    enumerateDevices: () => navigator.mediaDevices.enumerateDevices(),
    createAudioLevelMeter: (track) => createBrowserAudioLevelMeter(track),
  };
}

/**
 * One kind of device constraint, narrowed to the chosen device where there is one.
 *
 * IDEAL, NOT EXACT. A device unplugged between the check at the door and the host's admission must
 * not leave a guest in the room with nothing captured at all; the browser takes the chosen one where
 * it can and the nearest one where it cannot, which is what the person would have picked anyway.
 */
function narrowed(
  asked: boolean | MediaTrackConstraints | undefined,
  deviceId: string | null,
): boolean | MediaTrackConstraints {
  if (asked === undefined || asked === false) return false;
  if (deviceId === null) return asked;
  const base = asked === true ? {} : asked;
  return { ...base, deviceId: { ideal: deviceId } };
}

/**
 * A capture request with the chosen devices written into it.
 *
 * It narrows only what was ASKED for: a call asks for no picture, so a chosen camera must not turn
 * a request for sound into a request for a camera — that would light an indicator on somebody's
 * laptop in a room they were told carries no picture.
 */
export function withChosenDevices(
  constraints: MediaStreamConstraints,
  choice: GuestDeviceChoice,
): MediaStreamConstraints {
  return {
    ...constraints,
    audio: narrowed(constraints.audio, choice.microphoneId),
    video: narrowed(constraints.video, choice.cameraId),
  };
}

/** What the preview captures: the microphone always, and the camera only where the room has pictures. */
export function previewConstraints(
  medium: MeetingMedium,
  choice: GuestDeviceChoice,
): MediaStreamConstraints {
  return withChosenDevices({ audio: true, video: medium === "video" }, choice);
}

/**
 * The devices of one kind, in the words a picker shows.
 *
 * A browser that has not been granted access yet lists devices with no labels, so an unnamed one is
 * numbered rather than left blank: a picker offering three empty rows asks a question nobody can
 * answer.
 */
export function devicesOfKind(
  devices: readonly MediaDeviceInfo[],
  kind: "audioinput" | "videoinput",
): readonly GuestDeviceOption[] {
  const noun = kind === "audioinput" ? "Microphone" : "Camera";
  return devices
    .filter((device) => device.kind === kind && device.deviceId !== "")
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label === "" ? `${noun} ${String(index + 1)}` : device.label,
    }));
}

/** Which device a captured track actually came from, where the browser says. */
export function deviceOf(track: MediaStreamTrack | undefined): string | null {
  if (track === undefined || typeof track.getSettings !== "function") return null;
  return track.getSettings().deviceId ?? null;
}

/**
 * Let every track of a stream go, so no indicator light outlives the reason it came on. Named by
 * kind, because the microphone and the camera are the only two things this surface ever captures.
 */
export function releaseStream(stream: MediaStream | null): void {
  if (stream === null) return;
  for (const track of [...stream.getAudioTracks(), ...stream.getVideoTracks()]) track.stop();
}
