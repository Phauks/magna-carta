/*
 * The product's own background treatment: blur the room behind a member, or stand them in front of a
 * picture, in any browser that can draw in a worker, rather than only where the camera offers a blur
 * of its own.
 *
 * IT WRAPS THE PASS-THROUGH RATHER THAN REPLACING IT. The microphone's treatment, the read-back of
 * what the browser did, muting at the source and closing the capture are all still the pass-through's;
 * this stage adds the picture. Where the browser cannot draw in a worker, or the capture has no
 * camera, it IS the pass-through, and a member there sees the same panel they saw before.
 *
 * THE CAMERA'S OWN TRACK IS PUBLISHED UNTIL A TREATMENT IS CHOSEN. A member with no effect on pays
 * nothing for this stage: no worker, no engine download, no extra frame copy. Choosing one starts the
 * treatment and hands the room a different track; choosing none stops it and hands back the camera's.
 * `onChange` is how the client hears that the track changed, so it can swap what the connection sends
 * without a new offer.
 *
 * A TREATMENT THAT FAILS LEAVES THE MEMBER ON CAMERA, NOT OFF IT. Starting one that cannot start, or
 * one that stops working mid-meeting, falls back to the camera's own picture with the reason said in
 * the panel. Nothing here touches a browser global: the worker, the stored picture and the copy of a
 * bitmap all arrive through `BackgroundSeams`.
 */
import type {
  AppliedEffects,
  BackgroundChoice,
  EffectedCapture,
  MediaEffectSettings,
  MediaEffectsStage,
} from "./media-effects.ts";

/** A running treatment of the camera, as the stage needs it. effects/background-processor.ts is the real one. */
export interface BackgroundTreatment {
  readonly track: MediaStreamTrack;
  setBackground(mode: Exclude<BackgroundChoice, "none">, image: ImageBitmap | null): void;
  onFailure(listener: () => void): void;
  close(): void;
}

/** The edges this stage reaches the browser through. */
export interface BackgroundSeams {
  /** Whether this browser can draw a background at all. Asked once per capture. */
  supported(): boolean;
  /** Start treating the camera. Rejects where it cannot. */
  start(
    camera: MediaStreamTrack,
    mode: Exclude<BackgroundChoice, "none">,
    image: ImageBitmap | null,
  ): Promise<BackgroundTreatment>;
  /** The picture this browser remembers, or null. */
  loadImage(): Promise<ImageBitmap | null>;
  /** A copy of a picture, because handing one to the treatment gives it away. */
  copyImage(image: ImageBitmap): Promise<ImageBitmap>;
  /** A stream of these tracks, to publish. */
  createStream(tracks: MediaStreamTrack[]): MediaStream;
}

/** What a background that could not be started reads as. */
export const BACKGROUND_REFUSED = "Couldn't change your background in this browser.";

/** What a background that stopped working reads as. */
export const BACKGROUND_STOPPED =
  "Your background stopped working, so your camera is sent without it.";

/** What choosing "Image" before any picture reads as. The panel asks for one first, so this is a backstop. */
export const BACKGROUND_IMAGE_MISSING = "Choose a picture first.";

/** The product's background treatment over another stage (in a browser, the pass-through). */
export function backgroundEffects(
  inner: MediaEffectsStage,
  seams: BackgroundSeams,
): MediaEffectsStage {
  return {
    captureConstraints: (medium, settings) => inner.captureConstraints(medium, settings),

    async applyEffects(stream, settings): Promise<EffectedCapture> {
      const [found] = stream.getVideoTracks();
      if (found === undefined || !seams.supported()) {
        // The browser's own treatment and nothing more. A picture cannot be asked of it, so a member
        // who chose one on another machine gets their own room here rather than a refusal.
        const background = settings.background === "image" ? "none" : settings.background;
        return inner.applyEffects(stream, { ...settings, background });
      }

      // The browser's own blur is never asked for under this stage: the product draws the background,
      // and two blurs on one picture would be the camera's and then ours.
      const camera: MediaStreamTrack = found;
      const base = await inner.applyEffects(stream, { ...settings, background: "none" });
      const listeners: Array<(stream: MediaStream, applied: AppliedEffects) => void> = [];

      let mode: BackgroundChoice = "none";
      let treatment: BackgroundTreatment | null = null;
      let held: ImageBitmap | null = await seams.loadImage();
      let published: MediaStream = stream;
      let closed = false;
      // Changes are made one at a time: a member pressing Blur then Image quickly must end on Image,
      // never on whichever start happened to finish last.
      let queue: Promise<unknown> = Promise.resolve();

      function read(refusal: string | null): AppliedEffects {
        return {
          ...base.applied,
          blur: mode === "blur" ? "on" : "off",
          platformBlur: null,
          background: mode,
          backgroundByProduct: true,
          imageChosen: held !== null,
          refusal: refusal ?? base.applied.refusal,
        };
      }

      let applied: AppliedEffects = read(null);

      function publish(next: MediaStream): void {
        published = next;
      }

      function announce(refusal: string | null): AppliedEffects {
        applied = read(refusal);
        for (const listener of listeners) listener(published, applied);
        return applied;
      }

      function stopTreatment(): void {
        treatment?.close();
        treatment = null;
        mode = "none";
        publish(stream);
      }

      /** Move to `next`, answering the refusal if it could not be done. */
      async function turnTo(next: BackgroundChoice): Promise<string | null> {
        if (next === "none") {
          stopTreatment();
          return null;
        }
        if (next === "image" && held === null) return BACKGROUND_IMAGE_MISSING;
        const image = next === "image" && held !== null ? await seams.copyImage(held) : null;
        if (treatment !== null) {
          treatment.setBackground(next, image);
          mode = next;
          return null;
        }
        let started: BackgroundTreatment;
        try {
          started = await seams.start(camera, next, image);
        } catch {
          return BACKGROUND_REFUSED;
        }
        if (closed) {
          started.close();
          return null;
        }
        treatment = started;
        mode = next;
        started.track.enabled = camera.enabled;
        started.onFailure(() => {
          if (treatment !== started) return;
          stopTreatment();
          announce(BACKGROUND_STOPPED);
        });
        publish(seams.createStream([...stream.getAudioTracks(), started.track]));
        return null;
      }

      function serially<T>(act: () => Promise<T>): Promise<T> {
        const run = queue.then(act, act);
        queue = run.catch(() => undefined);
        return run;
      }

      const firstRefusal =
        settings.background === "none" ? null : await turnTo(settings.background);
      applied = read(firstRefusal);

      return {
        get stream(): MediaStream {
          return published;
        },
        get applied(): AppliedEffects {
          return applied;
        },
        update(next: MediaEffectSettings): Promise<AppliedEffects> {
          return serially(async () => {
            const audio = await base.update({ ...next, background: "none" });
            let refusal = audio.refusal;
            if (next.background !== mode) refusal = (await turnTo(next.background)) ?? refusal;
            return announce(refusal);
          });
        },
        chooseBackgroundImage(image: ImageBitmap): Promise<AppliedEffects> {
          return serially(async () => {
            held?.close();
            held = image;
            return announce(await turnTo("image"));
          });
        },
        setSourceEnabled(kind, enabled): void {
          base.setSourceEnabled(kind, enabled);
          if (kind === "video" && treatment !== null) treatment.track.enabled = enabled;
        },
        onChange(listener): void {
          listeners.push(listener);
        },
        close(): void {
          closed = true;
          treatment?.close();
          treatment = null;
          held?.close();
          held = null;
          base.close();
        },
      };
    },
  };
}
