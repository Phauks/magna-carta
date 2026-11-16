/*
 * The product's own noise filter on a member's microphone: steady noise (a fan, a keyboard, a road
 * outside) taken out by an engine running on their own computer, in place of the browser's noise
 * reduction, which varies from browser to browser and in some does very little.
 *
 * IT WRAPS ANOTHER STAGE RATHER THAN REPLACING IT, on the background stage's terms. Capture, the
 * camera, echo cancellation, volume levelling, muting at the source and closing the capture all stay
 * with the stage inside; this one adds a cleaned sound track. Where the browser cannot run the
 * filter, or the capture has no microphone, it IS the stage inside, and the switch is not offered.
 *
 * ONE FILTER, NEVER TWO. While the product's filter runs, the browser's own noise reduction is asked
 * off, because two noise filters in a row eat the quiet ends of words. Echo cancellation and volume
 * levelling stay on: the filter does neither.
 *
 * THE MICROPHONE'S OWN TRACK IS PUBLISHED UNTIL THE FILTER IS TURNED ON, and again the moment it fails.
 * A member who never turns it on pays nothing: no audio worklet and no engine download. A filter that
 * cannot start, or stops working mid-meeting, leaves the member heard as they were, with the reason in
 * the panel; it never leaves them silent. `onChange` is how the client hears that the sound track
 * changed, so it can swap what the connection sends without a new offer.
 */
import type { AppliedEffects, EffectedCapture, MediaEffectsStage } from "./media-effects.ts";

/** A running filter on one microphone, as the stage needs it. effects/noise-processor.ts is the real one. */
export interface NoiseTreatment {
  /** The cleaned sound, to publish in place of the microphone's own. */
  readonly track: MediaStreamTrack;
  /** Called once if the filter stops working. */
  onFailure(listener: () => void): void;
  /** Stop the filter and its track. The microphone itself is left exactly as it was. */
  close(): void;
}

/** The edges this stage reaches the browser through. */
export interface NoiseSeams {
  /** Whether this browser can run the filter at all. Asked once per capture. */
  supported(): boolean;
  /** Start filtering this microphone. Rejects where it cannot. */
  start(microphone: MediaStreamTrack): Promise<NoiseTreatment>;
  /** A stream of these tracks, to publish. */
  createStream(tracks: MediaStreamTrack[]): MediaStream;
}

/** What a filter that could not start reads as. */
export const NOISE_REMOVAL_REFUSED =
  "Stronger noise removal couldn't start in this browser, so your microphone is sent without it.";

/** What a filter that stopped working reads as. */
export const NOISE_REMOVAL_STOPPED =
  "Stronger noise removal stopped working, so your microphone is sent without it.";

/** The product's noise filter over another stage (in a browser, the background stage). */
export function noiseRemoval(inner: MediaEffectsStage, seams: NoiseSeams): MediaEffectsStage {
  return {
    // The capture is asked for the browser's noise reduction only where the product's filter will
    // not be standing in for it.
    captureConstraints: (medium, settings) =>
      inner.captureConstraints(
        medium,
        settings.removeNoise && seams.supported() ? { ...settings, reduceNoise: false } : settings,
      ),

    async applyEffects(stream, settings): Promise<EffectedCapture> {
      const [found] = stream.getAudioTracks();
      if (found === undefined || !seams.supported()) {
        const base = await inner.applyEffects(stream, { ...settings, removeNoise: false });
        return withUnavailable(base);
      }

      const microphone: MediaStreamTrack = found;
      const base = await inner.applyEffects(stream, browserSettings(settings));
      const listeners: Array<(stream: MediaStream, applied: AppliedEffects) => void> = [];

      let treatment: NoiseTreatment | null = null;
      let closed = false;
      // What the member last asked for, so a filter that fails later hands the browser back the
      // noise reduction they want now rather than what they wanted at the door.
      let wanted = settings;
      let queue: Promise<unknown> = Promise.resolve();

      /** The stream to publish: whatever the stage inside publishes, with the cleaned sound in it. */
      function published(): MediaStream {
        const inside = base.stream;
        if (treatment === null) return inside;
        return seams.createStream([treatment.track, ...inside.getVideoTracks()]);
      }

      function read(applied: AppliedEffects, refusal: string | null): AppliedEffects {
        return {
          ...applied,
          noiseRemoval: treatment === null ? "off" : "on",
          refusal: refusal ?? applied.refusal,
        };
      }

      let applied: AppliedEffects = base.applied;

      function announce(refusal: string | null): AppliedEffects {
        applied = read(base.applied, refusal);
        const stream = published();
        for (const listener of listeners) listener(stream, applied);
        return applied;
      }

      function stopTreatment(): void {
        treatment?.close();
        treatment = null;
      }

      /** Turn the filter on or off, answering the refusal if it could not be turned on. */
      async function turnTo(filtering: boolean): Promise<string | null> {
        if (!filtering) {
          stopTreatment();
          return null;
        }
        if (treatment !== null) return null;
        let started: NoiseTreatment;
        try {
          started = await seams.start(microphone);
        } catch {
          return NOISE_REMOVAL_REFUSED;
        }
        if (closed) {
          started.close();
          return null;
        }
        treatment = started;
        started.track.enabled = microphone.enabled;
        started.onFailure(() => {
          if (treatment !== started) return;
          stopTreatment();
          // The browser's own noise reduction comes back with the microphone's own track.
          void base
            .update({ ...wanted, removeNoise: false })
            .finally(() => announce(NOISE_REMOVAL_STOPPED));
        });
        return null;
      }

      function serially<T>(act: () => Promise<T>): Promise<T> {
        const run = queue.then(act, act);
        queue = run.catch(() => undefined);
        return run;
      }

      // A change the stage inside makes on its own (a background starting or stopping) is passed on
      // with the cleaned sound still in it.
      base.onChange?.((_stream, next) => {
        applied = read(next, null);
        const stream = published();
        for (const listener of listeners) listener(stream, applied);
      });

      const firstRefusal = settings.removeNoise ? await turnTo(true) : null;
      if (firstRefusal !== null) await base.update({ ...settings, removeNoise: false });
      applied = read(base.applied, firstRefusal);

      return {
        get stream(): MediaStream {
          return published();
        },
        get applied(): AppliedEffects {
          return applied;
        },
        update(next, change): Promise<AppliedEffects> {
          return serially(async () => {
            wanted = next;
            const refusal = await turnTo(next.removeNoise);
            const inside = await base.update(
              refusal === null ? browserSettings(next) : { ...next, removeNoise: false },
              change,
            );
            applied = read(inside, refusal);
            return announce(refusal);
          });
        },
        ...(base.chooseBackgroundImage === undefined
          ? {}
          : {
              chooseBackgroundImage: (image: ImageBitmap) =>
                base.chooseBackgroundImage?.(image).then((inside) => {
                  applied = read(inside, null);
                  return applied;
                }) ?? Promise.resolve(applied),
            }),
        setSourceEnabled(kind, enabled): void {
          base.setSourceEnabled(kind, enabled);
          if (kind === "audio" && treatment !== null) treatment.track.enabled = enabled;
        },
        onChange(listener): void {
          listeners.push(listener);
        },
        close(): void {
          closed = true;
          stopTreatment();
          base.close();
        },
      };
    },
  };
}

/** What the stage inside is asked for: the browser's noise reduction off while the filter stands in. */
function browserSettings<
  T extends { readonly reduceNoise: boolean; readonly removeNoise: boolean },
>(settings: T): T {
  return settings.removeNoise ? { ...settings, reduceNoise: false } : settings;
}

/** The stage inside, saying the filter is not possible here. */
function withUnavailable(base: EffectedCapture): EffectedCapture {
  const mark = (applied: AppliedEffects): AppliedEffects => ({
    ...applied,
    noiseRemoval: "unavailable",
  });
  return {
    get stream() {
      return base.stream;
    },
    get applied() {
      return mark(base.applied);
    },
    update: (next, change) => base.update({ ...next, removeNoise: false }, change).then(mark),
    ...(base.chooseBackgroundImage === undefined
      ? {}
      : {
          chooseBackgroundImage: (image: ImageBitmap) =>
            base.chooseBackgroundImage?.(image).then(mark) ?? Promise.resolve(mark(base.applied)),
        }),
    setSourceEnabled: (kind, enabled) => base.setSourceEnabled(kind, enabled),
    onChange: (listener) => base.onChange?.((stream, applied) => listener(stream, mark(applied))),
    close: () => base.close(),
  };
}
