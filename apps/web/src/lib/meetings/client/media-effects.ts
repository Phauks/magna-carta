/*
 * The stage between capturing a camera and publishing it.
 *
 * TODAY IT IS THE IDENTITY, and that is the whole of what is built here: `applyEffects` hands back
 * the stream it was given. The seam exists now because the two decisions it encodes are cheap to
 * make while nothing depends on them and expensive to retrofit once something does — background
 * blur and noise reduction (docs/specs/2026-09-20-meetings-media-effects-design.md) publish a
 * CANVAS track rather than the camera's own, and every caller that reached past this stage into
 * `localStream` would then be reaching for the wrong track.
 *
 * The two that would otherwise be got wrong:
 *
 *   * `setSourceEnabled` turns the DEVICE off, not the published track. Today they are the same
 *     track and the method is an indirection over `enabled`. Once a processing stage exists,
 *     disabling the published track publishes a black rectangle while the camera stays open and its
 *     light stays on — and a member who turned their picture off has every right to expect the light
 *     to go out.
 *   * `close()` owns whatever this stage captured. It captures nothing of its own today; a
 *     processing stage holds the raw camera track while the published one comes off a canvas.
 *     Whoever creates a track stops it, so teardown stays one call rather than a list of tracks the
 *     client has to remember.
 *
 * What is deliberately NOT here: a report of what the browser actually did with an effect, and a way
 * to change one without re-capturing. Both are answers about processing, and nothing processes yet —
 * they arrive with the slice that has something to report.
 */

/** What a member has asked for. Both are off, and only off, until the effects slice lands. */
export interface MediaEffectSettings {
  readonly background: "none" | "blur";
  readonly reduceNoise: boolean;
}

/** Nothing asked for, which is every capture today. */
export const NO_EFFECTS: MediaEffectSettings = { background: "none", reduceNoise: false };

/** A capture as the stage hands it on: what to publish, and the two acts the stage owns. */
export interface EffectedCapture {
  /** The stream to publish. Under the pass-through this is the captured stream itself. */
  readonly stream: MediaStream;
  /** Mute at the SOURCE as well as the output, so a camera light actually goes out. */
  setSourceEnabled(kind: "audio" | "video", enabled: boolean): void;
  /** Stop every track this stage owns, including any it captured itself. */
  close(): void;
}

export interface MediaEffectsStage {
  applyEffects(stream: MediaStream, settings: MediaEffectSettings): Promise<EffectedCapture>;
}

/** No processing at all: the stream is returned unchanged and the two acts fall through to it. */
export function passThroughEffects(): MediaEffectsStage {
  return {
    applyEffects(stream: MediaStream): Promise<EffectedCapture> {
      return Promise.resolve({
        stream,
        setSourceEnabled(kind: "audio" | "video", enabled: boolean): void {
          const tracks = kind === "audio" ? stream.getAudioTracks() : stream.getVideoTracks();
          for (const track of tracks) track.enabled = enabled;
        },
        close(): void {
          for (const track of stream.getTracks()) track.stop();
        },
      });
    },
  };
}
