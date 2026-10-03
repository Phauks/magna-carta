import { PCM_SAMPLE_RATE } from "./pcm-frame.ts";

// WHERE SOMEBODY IS TALKING ON ONE TRACK, read from the track's own audio.
//
// The transcript is made per track rather than from the composite, so that every line is attributed to
// the person whose microphone it came from instead of to a number a diarizing model made up. And it is
// made of SPEECH SPANS rather than of the whole track, because a participant in a five-person meeting
// talks for a fifth of it at most: sending the other four fifths to the speech model costs four times
// as much and invites the model to hallucinate words into silence and room noise, which it does.
//
// THE SPANS COME FROM THE AUDIO'S ENERGY. Nothing else records when somebody spoke — the room relays a
// speaking flag to the browsers and keeps none of it — and energy is the fact the staged audio carries
// whatever any other part of the platform did. Each twenty-millisecond frame's level is measured in
// decibels below full scale, the track's NOISE FLOOR is taken as a low percentile of those levels (the
// quiet the microphone sits at when its owner is not talking — a laptop fan, a room, or the digital
// silence the recorder writes for audio that never arrived), and a frame is VOICED when it stands
// clearly above that floor. A threshold relative to the track's own floor is what lets one rule serve a
// headset in a quiet office and a laptop in a café: an absolute level would hear the café as talking
// and the headset's quiet speaker as silence. The threshold is held between two bounds so that a track
// of digital silence does not hear faint hiss as speech, and a stretch that is nearly all speech (whose
// low percentile is itself speech) still hears the speech.
//
// A SPAN IS VOICED FRAMES WITH A HANGOVER. Speech is not continuously loud — the gaps between words and
// the soft ends of words fall below the threshold — so a span runs on through up to a hangover's worth
// of quiet, and ends that long after its last voiced frame, which is what keeps a trailing consonant or
// a breath before the next word from being clipped. It begins a short pre-roll before its first voiced
// frame for the same reason at the other end. A burst too short to be a syllable (a click, a cough on a
// muted-then-unmuted microphone) is not a span.
//
// A SPAN IS CUT INTO PIECES THE MODEL TAKES. Thirty seconds is the speech model's own window, so a span
// longer than that is cut — at the quietest frame of the last two seconds before the thirty when one of
// them is quiet, so the cut falls between words, and at exactly thirty seconds when nobody paused.
//
// THE AUDIO IS READ A REGION AT A TIME, because one track of a long meeting is hundreds of megabytes and
// a worker holds a hundred and twenty-eight. A region ending mid-sentence must not cut the sentence at
// the region's edge, so a span still open at the end of a region that is not the track's last is not
// taken: the plan says where to resume — the start of that span's last piece — and the next region
// begins there and sees it whole.
//
// Pure TypeScript with no binding and no clock.

/** One frame: twenty milliseconds of the recorder's 48 kHz audio. */
export const SPEECH_FRAME_SAMPLES = (PCM_SAMPLE_RATE * 20) / 1000;

/** A frame of nothing but zeros, in decibels below full scale — below anything a microphone hears. */
export const SILENT_FRAME_LEVEL = -100;

/** The fraction of a region's frames quieter than its noise floor. */
export const NOISE_FLOOR_PERCENTILE = 0.1;

/** How far above the noise floor a frame must stand to be voiced, in decibels. */
export const VOICED_ABOVE_FLOOR_DECIBELS = 10;

/** The quietest a voiced frame may be, whatever the floor: below it is hiss on a silent track. */
export const QUIETEST_VOICED_LEVEL = -55;

/**
 * The loudest the threshold may ask for, whatever the floor: ordinary speech into a microphone sits
 * between about -20 and -10 dB, so it always clears this — while a room as loud as -35 dB still has a
 * threshold above its own noise.
 */
export const LOUDEST_VOICED_THRESHOLD = -25;

/** How long before its first voiced frame a span begins: 100 ms. */
export const PRE_ROLL_FRAMES = 5;

/** How much quiet a span runs on through, and runs on for after its last voiced frame: 300 ms. */
export const HANGOVER_FRAMES = 15;

/** The fewest voiced frames a span must hold to be speech rather than a click: 60 ms. */
export const MINIMUM_VOICED_FRAMES = 3;

/** The longest piece the speech model is sent: thirty seconds, its own window. */
export const MAXIMUM_PIECE_FRAMES = 1_500;

/** How far back from a thirty-second cut a quieter place to cut is looked for: two seconds. */
export const CUT_SEARCH_FRAMES = 100;

/** A run of frames, `[fromFrame, toFrame)`, counted from the start of the region measured. */
export interface FrameRange {
  readonly fromFrame: number;
  readonly toFrame: number;
}

/**
 * The level of each frame of `samples`, in decibels below full scale, written into `levels` from
 * `atFrame`. A last frame shorter than twenty milliseconds is measured over what it has. Answers how
 * many frames were written.
 */
export function writeFrameLevels(samples: Int16Array, levels: Float32Array, atFrame = 0): number {
  const frames = Math.ceil(samples.length / SPEECH_FRAME_SAMPLES);
  if (atFrame < 0 || atFrame + frames > levels.length) {
    throw new RangeError("the frames measured do not fit where they were asked to be written");
  }
  for (let frame = 0; frame < frames; frame += 1) {
    const from = frame * SPEECH_FRAME_SAMPLES;
    const to = Math.min(samples.length, from + SPEECH_FRAME_SAMPLES);
    let squares = 0;
    for (let position = from; position < to; position += 1) {
      const sample = samples[position] ?? 0;
      squares += sample * sample;
    }
    const meanSquare = squares / (to - from);
    levels[atFrame + frame] =
      meanSquare === 0
        ? SILENT_FRAME_LEVEL
        : Math.max(SILENT_FRAME_LEVEL, 10 * Math.log10(meanSquare / (32_768 * 32_768)));
  }
  return frames;
}

/** The level of each frame of `samples`, for a caller that holds the whole of what it measures. */
export function frameLevels(samples: Int16Array): Float32Array {
  const levels = new Float32Array(Math.ceil(samples.length / SPEECH_FRAME_SAMPLES));
  writeFrameLevels(samples, levels);
  return levels;
}

/**
 * A region's noise floor: the level its quietest tenth of HEARD frames sits at or below.
 *
 * A frame of nothing but zeros is left out of the count. Those are the recorder's own writing — the
 * silence it stages for a muted microphone or frames that never arrived — not the room the microphone
 * sits in; counted, a region a tenth of which was muted has a floor of -100 dB, the threshold falls to
 * its lowest bound, and ordinary room noise is sent to the model as speech, which costs money and invites
 * it to hallucinate words. A region of nothing but zeros has the silent level as its floor.
 */
export function noiseFloor(levels: Float32Array): number {
  const heard = levels.filter((level) => level > SILENT_FRAME_LEVEL).toSorted();
  if (heard.length === 0) return SILENT_FRAME_LEVEL;
  return heard[Math.min(heard.length - 1, Math.floor(heard.length * NOISE_FLOOR_PERCENTILE))]!;
}

/** The level a frame of this region must reach to be voiced. */
export function voicedThreshold(levels: Float32Array): number {
  return Math.min(
    LOUDEST_VOICED_THRESHOLD,
    Math.max(QUIETEST_VOICED_LEVEL, noiseFloor(levels) + VOICED_ABOVE_FLOOR_DECIBELS),
  );
}

/** One span of speech, and whether it is still open at the end of what was measured. */
export interface SpeechSpan extends FrameRange {
  // True when the region ended before the span's hangover did: the speaker may still be talking.
  readonly open: boolean;
}

/** The spans of speech in a region's levels, in order and never overlapping. */
export function detectSpeechSpans(levels: Float32Array, threshold: number): SpeechSpan[] {
  const spans: SpeechSpan[] = [];
  let previousEnd = 0;
  let start = -1;
  let lastVoiced = -1;
  let voiced = 0;
  const close = (end: number, open: boolean) => {
    if (voiced >= MINIMUM_VOICED_FRAMES) {
      spans.push({ fromFrame: start, toFrame: end, open });
      previousEnd = end;
    }
    start = -1;
    voiced = 0;
  };
  for (let frame = 0; frame < levels.length; frame += 1) {
    if ((levels[frame] ?? SILENT_FRAME_LEVEL) >= threshold) {
      if (start < 0) start = Math.max(previousEnd, frame - PRE_ROLL_FRAMES, 0);
      lastVoiced = frame;
      voiced += 1;
    } else if (start >= 0 && frame - lastVoiced > HANGOVER_FRAMES) {
      close(lastVoiced + 1 + HANGOVER_FRAMES, false);
    }
  }
  if (start >= 0) {
    const end = lastVoiced + 1 + HANGOVER_FRAMES;
    close(Math.min(end, levels.length), end > levels.length);
  }
  return spans;
}

/**
 * One span cut into pieces no longer than the model's window: each cut at the quietest frame of the
 * two seconds before the thirty when that frame is below the threshold, at exactly thirty otherwise.
 */
export function cutSpan(span: FrameRange, levels: Float32Array, threshold: number): FrameRange[] {
  const pieces: FrameRange[] = [];
  let from = span.fromFrame;
  while (span.toFrame - from > MAXIMUM_PIECE_FRAMES) {
    const hardCut = from + MAXIMUM_PIECE_FRAMES;
    let quietest = -1;
    let quietestLevel = Number.POSITIVE_INFINITY;
    for (let frame = hardCut - CUT_SEARCH_FRAMES; frame < hardCut; frame += 1) {
      const level = levels[frame] ?? SILENT_FRAME_LEVEL;
      if (level < quietestLevel) {
        quietestLevel = level;
        quietest = frame;
      }
    }
    // Cut AFTER the quiet frame, so the piece ends in the pause rather than just short of it.
    const cut = quietestLevel < threshold && quietest + 1 > from ? quietest + 1 : hardCut;
    pieces.push({ fromFrame: from, toFrame: cut });
    from = cut;
  }
  if (span.toFrame > from) pieces.push({ fromFrame: from, toFrame: span.toFrame });
  return pieces;
}

/** What to send from one region, and where the next region begins. */
export interface SpeechPlan {
  readonly pieces: readonly FrameRange[];
  // The frame the next region of this track begins at: the region's end when it is the track's last.
  readonly resumeFrame: number;
}

/**
 * THE PIECES OF ONE REGION, and where to resume. `final` says the region runs to the end of what the
 * track holds, so nothing in it can still be going on; otherwise a span still open at the region's end
 * keeps its last piece back, and the plan resumes at that piece's start. With nothing open, it resumes a
 * pre-roll short of the region's end — never before the last span it took — so a word beginning right
 * at the edge keeps its run-up.
 *
 * A region that would resume at its own start with nothing taken is treated as final rather than
 * handed back unchanged, so a plan always moves the transcript forward.
 */
export function planSpeechPieces(
  levels: Float32Array,
  options: { readonly final: boolean },
): SpeechPlan {
  const threshold = voicedThreshold(levels);
  const spans = detectSpeechSpans(levels, threshold);
  const pieces: FrameRange[] = [];
  let resumeFrame = levels.length;
  let lastTaken = 0;
  for (const span of spans) {
    const cut = cutSpan(span, levels, threshold);
    if (span.open && !options.final) {
      const held = cut.at(-1)!;
      pieces.push(...cut.slice(0, -1));
      resumeFrame = held.fromFrame;
      break;
    }
    pieces.push(...cut);
    lastTaken = span.toFrame;
  }
  if (!options.final && resumeFrame === levels.length) {
    resumeFrame = Math.max(lastTaken, levels.length - PRE_ROLL_FRAMES);
  }
  if (!options.final && pieces.length === 0 && resumeFrame === 0) {
    return planSpeechPieces(levels, { final: true });
  }
  return { pieces, resumeFrame: options.final ? levels.length : resumeFrame };
}

/** A frame count as recorder samples. */
export function framesToSamples(frames: number): number {
  return frames * SPEECH_FRAME_SAMPLES;
}
