/*
 * Whether this browser's own microphone is carrying speech.
 *
 * WHO IS TALKING IS MEASURED ONCE, AT THE SOURCE. A room of three hundred cannot have three hundred
 * browsers each analysing three hundred incoming tracks to work out who is speaking: that is ninety
 * thousand analysers for one fact. Each browser measures the one microphone it owns and tells the
 * room; the room relays the answer. This is that measurement, and nothing else in the meeting
 * listens to audio for any reason.
 *
 * IT IS A SEAM BECAUSE IT IS A DEVICE. An AudioContext needs a real audio pipeline and a gesture to
 * start it, neither of which exists under a test, so the client takes a meter as a constructor seam
 * and a test drives a fake one directly.
 */

/** A running measurement of one track. Start it once, stop it when the track goes away. */
export interface AudioLevelMeter {
  /** Begin measuring. The callback is called only when the answer CHANGES. */
  start: (onSpeaking: (speaking: boolean) => void) => void;
  stop: () => void;
}

/** How often the level is read. Roughly one frame of speech, which is what the ear hears as one. */
const FRAME_MILLISECONDS = 50;

/**
 * How long the level must stay on one side of the line before the answer changes.
 *
 * Both directions, and deliberately equal. Without it going up, every consonant is its own
 * announcement; without it going down, every pause for breath says somebody stopped talking, and
 * the gallery re-orders itself under a reader mid-sentence.
 */
const HYSTERESIS_MILLISECONDS = 300;

/**
 * The root-mean-square level above which a frame counts as speech.
 *
 * Room noise on a laptop microphone sits an order of magnitude under this; a voice at a
 * conversational distance sits well over it. It is deliberately not adaptive — a floor that follows
 * the room would learn a fan as speech given enough of a pause.
 */
const SPEECH_LEVEL = 0.05;

/** How much history the analyser keeps per read. The smallest size the platform offers. */
const ANALYSER_FFT_SIZE = 256;

/** The presses a browser counts as letting a page start sound. */
const GESTURES = ["pointerdown", "keydown"] as const;

/**
 * Whether this page may start an AudioContext now. A meeting opens in its own tab, and a tab opened
 * by a press in another tab has had no press of its own, so the browser starts any context it makes
 * suspended (with a console warning) and a suspended analyser reads silence: the person's own
 * speaking mark would never light. Where the browser cannot say, assume it may.
 */
function pageMayStartSound(): boolean {
  return navigator.userActivation?.hasBeenActive ?? true;
}

/** The seam as a real browser supplies it: an analyser over the captured track. */
export function createBrowserAudioLevelMeter(track: MediaStreamTrack): AudioLevelMeter {
  let context: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let speaking = false;
  /** When the level first crossed to the side it is now on, or null while it agrees with the answer. */
  let crossedAt: number | null = null;
  /** Set while the meter waits for the page's first press before it starts measuring. */
  let waitingForGesture: (() => void) | null = null;

  function stopWaiting(): void {
    if (waitingForGesture === null) return;
    for (const gesture of GESTURES) window.removeEventListener(gesture, waitingForGesture, true);
    waitingForGesture = null;
  }

  const meter: AudioLevelMeter = {
    start(onSpeaking: (speaking: boolean) => void): void {
      if (context !== null || waitingForGesture !== null) return;
      if (!pageMayStartSound()) {
        // The first press anywhere on the page starts the meter, and the meeting carries on meanwhile.
        const begin = (): void => {
          stopWaiting();
          meter.start(onSpeaking);
        };
        waitingForGesture = begin;
        for (const gesture of GESTURES) window.addEventListener(gesture, begin, true);
        return;
      }
      context = new AudioContext();
      if (context.state === "suspended") void context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = ANALYSER_FFT_SIZE;
      context.createMediaStreamSource(new MediaStream([track])).connect(analyser);
      const frame = new Float32Array(analyser.fftSize);

      timer = setInterval(() => {
        analyser.getFloatTimeDomainData(frame);
        let sum = 0;
        for (const sample of frame) sum += sample * sample;
        const level = Math.sqrt(sum / frame.length);

        const loud = level >= SPEECH_LEVEL;
        if (loud === speaking) {
          crossedAt = null;
          return;
        }
        const now = Date.now();
        crossedAt ??= now;
        if (now - crossedAt < HYSTERESIS_MILLISECONDS) return;
        crossedAt = null;
        speaking = loud;
        onSpeaking(speaking);
      }, FRAME_MILLISECONDS);
    },
    stop(): void {
      stopWaiting();
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      void context?.close();
      context = null;
      speaking = false;
      crossedAt = null;
    },
  };
  return meter;
}
