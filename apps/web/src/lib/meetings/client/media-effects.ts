/*
 * The stage between capturing a microphone and camera and publishing them: what is asked of the
 * browser's own treatment, what the browser says it actually did, and the seam a processing stage
 * will one day stand in.
 *
 * TODAY THE STAGE IS THE IDENTITY ON THE STREAM, WITH A DESCRIPTION ATTACHED. `applyEffects` hands
 * back the stream it was given; what it adds is the reading of that stream's tracks, so the member
 * is told what their browser did rather than what we hoped it would. Everything here is plain
 * TypeScript with no browser global in it: a track and a stream arrive as arguments, and the one
 * question about the platform itself (which constraint names it knows) arrives as a value.
 *
 * WHAT IS ASKED FOR IS ALWAYS A PLAIN BOOLEAN, NEVER `{ exact: true }`. An exact constraint the device
 * cannot meet rejects the whole capture, and what the member then reads is that their microphone is
 * not available in this browser. A member with no microphone because the product insisted on a
 * filter is strictly worse off than a member with an unfiltered one, so every treatment here is a
 * request the browser may decline and then report.
 *
 * WHAT THE BROWSER REPORTS IS THREE-VALUED. `getSupportedConstraints()` names constraints a browser
 * does not implement, so it is not asked whether a treatment is running; the track's own settings
 * are. Browsers disagree about what they report: one applies noise suppression and does not list it,
 * another lists neither noise suppression nor gain control, a third lists all three. A boolean
 * would have to say "off" about a treatment that is running in two of those three, so a setting the
 * track does not report reads as `null`, and the screen says the browser decides it.
 *
 * TWO DECISIONS THAT A LATER PROCESSING STAGE WOULD OTHERWISE GET WRONG:
 *
 *   * `setSourceEnabled` turns the DEVICE off, not the published track. Under the pass-through they
 *     are the same track. Once a processing stage publishes a canvas track instead, disabling the
 *     published track would send a black rectangle while the camera stayed open with its light on,
 *     and a member who turned their picture off has every right to expect the light to go out.
 *   * `close()` owns whatever this stage captured. It captures nothing of its own today; a processing
 *     stage holds the raw camera track while the published one comes off a canvas. Whoever creates a
 *     track stops it, so teardown stays one call rather than a list the client has to remember.
 */
import type { MeetingMedium } from "@magna-carta/meeting-protocol/types";

/** What a member has asked for. Held per browser, because what is possible is a fact about a machine. */
export interface MediaEffectSettings {
  readonly background: "none" | "blur";
  readonly reduceNoise: boolean;
}

/**
 * What a member gets before they have chosen anything: their own background, and the browser's noise
 * reduction on. Noise reduction is on because it is what almost everybody in a meeting wants of
 * somebody else's microphone, and it costs nothing a member would notice.
 */
export const DEFAULT_EFFECT_SETTINGS: MediaEffectSettings = {
  background: "none",
  reduceNoise: true,
};

/** Nothing asked for at all: no background treatment and no noise reduction. */
export const NO_EFFECTS: MediaEffectSettings = { background: "none", reduceNoise: false };

/** What one treatment reads as: on, off, or null where the browser did not report it at all. */
export type TreatmentReading = boolean | null;

/** The browser's own sound treatment, as the microphone track reports it. */
export interface AudioTreatment {
  readonly noiseSuppression: TreatmentReading;
  readonly echoCancellation: TreatmentReading;
  readonly autoGainControl: TreatmentReading;
  readonly voiceIsolation: TreatmentReading;
}

/**
 * Whether this camera's background can be blurred from here.
 *
 * `controllable` — the track offers both positions, so the product may set it. `platform-controlled`
 * — it offers exactly one, which is the machine saying the setting lives somewhere no application may
 * touch (a system control panel). `unavailable` — the browser does not offer it at all, which is the
 * answer nearly everywhere.
 */
export type BlurCapability = "controllable" | "platform-controlled" | "unavailable";

/** What the background is doing, as far as this browser can say. */
export type BlurStanding = "on" | "off" | "platform-controlled" | "unavailable";

/** What was applied, in the terms the Effects panel draws. */
export interface AppliedEffects {
  readonly audio: AudioTreatment;
  readonly blur: BlurStanding;
  /**
   * Where the machine decides the blur, which way it has it set. Null wherever the product decides
   * it or nothing does, and null where the machine decides and does not say.
   */
  readonly platformBlur: boolean | null;
  /** Present only when an effect was asked for and could not be given, in the product's own words. */
  readonly refusal: string | null;
}

/** A capture as the stage hands it on: what to publish, what was applied, and the acts it owns. */
export interface EffectedCapture {
  /** The stream to publish. Under the pass-through this is the captured stream itself. */
  readonly stream: MediaStream;
  /** What the browser reported once the effects were asked for. */
  readonly applied: AppliedEffects;
  /** Change an effect without capturing again, where the effect allows it, and read the result. */
  update(settings: MediaEffectSettings): Promise<AppliedEffects>;
  /** Mute at the SOURCE as well as the output, so a camera light actually goes out. */
  setSourceEnabled(kind: "audio" | "video", enabled: boolean): void;
  /** Stop every track this stage owns, including any it captured itself. */
  close(): void;
}

export interface MediaEffectsStage {
  /**
   * What to capture with. The stage says it rather than the client, because the stage is what will
   * process the capture, and a processing stage is the one that knows what it needs to be handed.
   */
  captureConstraints(medium: MeetingMedium, settings: MediaEffectSettings): MediaStreamConstraints;
  applyEffects(stream: MediaStream, settings: MediaEffectSettings): Promise<EffectedCapture>;
}

/**
 * The constraint names this browser has heard of, for the one treatment where that matters.
 *
 * An unknown key in a constraint set is ignored, so asking for voice isolation where the name means
 * nothing costs nothing; it is asked only where the name is known so that what the product asked for
 * is what it can later read back.
 */
export interface KnownConstraintNames {
  readonly voiceIsolation?: boolean;
}

/** What the camera is asked for: a picture a gallery can step down three times, at a steady rate. */
function cameraConstraints(): MediaTrackConstraints {
  return { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
}

/**
 * What the microphone is asked for, WHOLE.
 *
 * It is always stated whole because `applyConstraints` replaces what a track was asked for rather than
 * adding to it: re-asking for noise suppression alone would quietly drop the echo cancellation, and
 * a member who turned one treatment off would lose a second one they never touched.
 */
export function audioConstraints(
  settings: MediaEffectSettings,
  known: KnownConstraintNames = {},
): MediaTrackConstraints {
  return {
    // Plain booleans, never `{ exact: true }`: see the head of this file. An exact treatment the
    // device cannot give fails the capture outright and leaves the member with no microphone at all.
    noiseSuppression: settings.reduceNoise,
    echoCancellation: true,
    autoGainControl: true,
    // Voice isolation is the stronger form of the same treatment, so it follows the same choice.
    ...(known.voiceIsolation === true ? { voiceIsolation: settings.reduceNoise } : {}),
  };
}

/**
 * What a room captures: the microphone with its treatment asked for explicitly, and in a meeting the
 * camera. A call asks for no camera at all, because opening one lights the device's own indicator
 * and a member who started a call did not agree to that.
 */
export function captureConstraints(
  medium: MeetingMedium,
  settings: MediaEffectSettings,
  known: KnownConstraintNames = {},
): MediaStreamConstraints {
  return {
    audio: audioConstraints(settings, known),
    video: medium === "video" ? cameraConstraints() : false,
  };
}

/** One reported value, where the browser reported one. */
function readReported(source: object, name: string): TreatmentReading {
  const value: unknown = Reflect.get(source, name);
  return typeof value === "boolean" ? value : null;
}

/** A track's own report of what it is doing, or nothing where it offers no report. */
function settingsOf(track: MediaStreamTrack | undefined): object {
  if (track === undefined || typeof track.getSettings !== "function") return {};
  return track.getSettings();
}

/** Nothing reported about any treatment: a browser that decides all of it and says none of it. */
const UNREPORTED_TREATMENT: AudioTreatment = {
  noiseSuppression: null,
  echoCancellation: null,
  autoGainControl: null,
  voiceIsolation: null,
};

/**
 * What the browser says it is doing to the microphone, read off the track rather than assumed from
 * what was asked. A setting the track does not report is `null`, never `false`: the browser may well
 * be applying it.
 */
export function readAudioTreatment(track: MediaStreamTrack | undefined): AudioTreatment {
  if (track === undefined) return UNREPORTED_TREATMENT;
  const settings = settingsOf(track);
  return {
    noiseSuppression: readReported(settings, "noiseSuppression"),
    echoCancellation: readReported(settings, "echoCancellation"),
    autoGainControl: readReported(settings, "autoGainControl"),
    voiceIsolation: readReported(settings, "voiceIsolation"),
  };
}

/**
 * Whether this camera's background can be blurred from here, read off the track's capabilities.
 *
 * Two positions offered is a control the product may set; one is the machine deciding; none, or no
 * capabilities at all, is a browser that does not offer it.
 */
export function readBlurCapability(track: MediaStreamTrack | undefined): BlurCapability {
  if (track === undefined || typeof track.getCapabilities !== "function") return "unavailable";
  const offered: unknown = Reflect.get(track.getCapabilities(), "backgroundBlur");
  if (!Array.isArray(offered)) return "unavailable";
  if (offered.length >= 2) return "controllable";
  if (offered.length === 1) return "platform-controlled";
  return "unavailable";
}

/** Whether a track can be asked to change at all. A track that cannot is left exactly as it is. */
function acceptsConstraints(track: MediaStreamTrack | undefined): track is MediaStreamTrack {
  return track !== undefined && typeof track.applyConstraints === "function";
}

/** What a refused microphone treatment reads as. Said in the panel, never as a toast. */
export const AUDIO_TREATMENT_REFUSED = "Your browser did not change how it treats your microphone.";

/** What a refused background blur reads as, in whichever direction it was asked. */
export function blurRefusal(wanted: boolean): string {
  return wanted
    ? "Your browser did not blur your background."
    : "Your browser did not stop blurring your background.";
}

/**
 * The browser's own treatment and nothing else: the stream is published exactly as captured, and
 * what the stage adds is asking the tracks for what was chosen and reading back what they did.
 */
export function passThroughEffects(known: KnownConstraintNames = {}): MediaEffectsStage {
  return {
    captureConstraints: (medium, settings) => captureConstraints(medium, settings, known),

    async applyEffects(stream, settings): Promise<EffectedCapture> {
      const [camera] = stream.getVideoTracks();
      /*
       * A camera that refused to be blurred is not asked again. The browser offered the control and
       * then declined it, so from here the machine is what decides — which is what the panel says,
       * rather than offering a toggle that has already failed once.
       */
      let blurDeclined = false;

      /** Ask the camera for blur, restating the picture it was captured with. */
      async function askForBlur(wanted: boolean): Promise<string | null> {
        if (!acceptsConstraints(camera) || readBlurCapability(camera) !== "controllable") {
          return null;
        }
        if (blurDeclined) return null;
        // Restated whole for the reason the microphone's constraints are: `applyConstraints`
        // replaces, so asking for blur alone would drop the resolution the camera was opened at.
        const asked: MediaTrackConstraints = { ...cameraConstraints(), backgroundBlur: wanted };
        try {
          await camera.applyConstraints(asked);
          return null;
        } catch {
          blurDeclined = true;
          return blurRefusal(wanted);
        }
      }

      /** What the tracks now say, with the one refusal this change produced, if any. */
      function read(refusal: string | null): AppliedEffects {
        const capability = blurDeclined ? "platform-controlled" : readBlurCapability(camera);
        const reportedBlur = readReported(settingsOf(camera), "backgroundBlur");
        let blur: BlurStanding;
        if (capability === "controllable") blur = reportedBlur === true ? "on" : "off";
        else blur = capability;
        return {
          audio: readAudioTreatment(stream.getAudioTracks()[0]),
          blur,
          platformBlur: blur === "platform-controlled" ? reportedBlur : null,
          refusal,
        };
      }

      // The microphone's treatment was asked for in the capture itself, so only the background is
      // asked for here, and only where somebody chose it: an untouched camera is left untouched.
      const firstRefusal = settings.background === "blur" ? await askForBlur(true) : null;
      let applied = read(firstRefusal);

      return {
        stream,
        get applied(): AppliedEffects {
          return applied;
        },
        async update(next): Promise<AppliedEffects> {
          let refusal: string | null = null;
          const [microphone] = stream.getAudioTracks();
          if (acceptsConstraints(microphone)) {
            try {
              await microphone.applyConstraints(audioConstraints(next, known));
            } catch {
              refusal = AUDIO_TREATMENT_REFUSED;
            }
          }
          const wantsBlur = next.background === "blur";
          if (applied.blur === "on" || applied.blur === "off") {
            const blurred = applied.blur === "on";
            if (blurred !== wantsBlur) refusal = (await askForBlur(wantsBlur)) ?? refusal;
          }
          applied = read(refusal);
          return applied;
        },
        setSourceEnabled(kind, enabled): void {
          const tracks = kind === "audio" ? stream.getAudioTracks() : stream.getVideoTracks();
          for (const track of tracks) track.enabled = enabled;
        },
        close(): void {
          for (const track of stream.getTracks()) track.stop();
        },
      };
    },
  };
}

/**
 * The one line beneath the noise switch: what else the browser says it is doing to the microphone.
 *
 * Composed from the reading rather than written per browser, so it can only ever state what the
 * track reported. Where the track does not report noise suppression at all, that is the fact the
 * member needs, and it is the whole line.
 */
export function audioTreatmentStatement(audio: AudioTreatment): string {
  if (audio.noiseSuppression === null) return "Your browser decides this and does not report it.";
  const echo = audio.echoCancellation === true;
  const gain = audio.autoGainControl === true;
  if (echo && gain) return "Your browser is also cancelling echo and managing gain.";
  if (echo) return "Your browser is also cancelling echo.";
  if (gain) return "Your browser is also managing gain.";
  return "Your browser is not cancelling echo or managing gain.";
}

/** The one line a background section is, where the machine rather than the product decides it. */
export function platformBlurStatement(platformBlur: boolean | null): string {
  if (platformBlur === true) return "Background blur is on, set in your computer's own settings.";
  if (platformBlur === false) return "Background blur is off, set in your computer's own settings.";
  return "Background blur is set in your computer's own settings.";
}

/** The one line a background section is, where this browser offers no blur at all. */
export const BLUR_UNAVAILABLE_STATEMENT = "Background blur is not available in this browser.";
