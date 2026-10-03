// LIVE CAPTIONS, AS ARITHMETIC — every number the Worker's captioner runs on, and the pure decisions
// made from them, held here so each is stated once, with its reason, and tested without a runtime.
//
// The captioner (apps/api-worker/src/meetings/meeting-captioner.ts) opens a caption session for one
// person only while they are speaking, feeds it the audio the routing service sends, and hands the
// words it hears to the room, which fans them out to every socket. Nothing here holds a caption: a
// caption is a display, and the transcript is the record. What is here is WHEN a session opens and
// closes, how many may be open, how fast interim words may go out, and how long the text may be.

// ---------------------------------------------------------------------------------------------
// When a session lives
// ---------------------------------------------------------------------------------------------

/**
 * HOW LONG SOMEBODY MAY BE SILENT BEFORE THEIR CAPTION SESSION CLOSES. A session is opened on the
 * `speaking` presence the room already relays and closed this long after it last said they stopped.
 *
 * It is the single largest cost decision in captions: the model bills by the minute of audio it is
 * sent, and in a real meeting roughly one person talks at a time, so a session per speaker closed after
 * a short silence bills near the length of the meeting rather than its length times the number of
 * people in it. Three seconds outlasts the pause between sentences — a session closed and reopened at
 * every breath would lose the first words of each sentence to the reopening — and is short enough that
 * a listener's open microphone is not billed for a minute after they said one word.
 */
export const CAPTION_SILENCE_CLOSE_MILLISECONDS = 3_000;

/**
 * HOW LONG A SESSION'S AUDIO SOCKET MAY BE GONE before the session is closed for want of it. The routing
 * service redials the same address for up to five seconds after a drop; twice that is the allowance,
 * after which nobody is being heard and the model is being kept open for nothing. It is what closes the
 * session of somebody who left while they were still marked speaking, whatever path took them out.
 */
export const CAPTION_AUDIO_LOSS_GRACE_MILLISECONDS = 10_000;

/**
 * HOW LONG A SESSION MAY GO WITHOUT SENDING THE MODEL ANYTHING before it is sent a keepalive. The model
 * closes a stream after ten seconds with neither audio nor a keepalive, and asks for one every three to
 * five seconds; four is inside that, and only spent while the audio has stalled.
 */
export const CAPTION_KEEP_ALIVE_MILLISECONDS = 4_000;

/** When a session whose speaker went quiet at `silentSince` is due to close. */
export function captionSilenceDeadline(silentSince: number): number {
  return silentSince + CAPTION_SILENCE_CLOSE_MILLISECONDS;
}

// ---------------------------------------------------------------------------------------------
// How many, and how much each holds
// ---------------------------------------------------------------------------------------------

/**
 * THE MOST CAPTION SESSIONS ONE MEETING HOLDS OPEN AT ONCE.
 *
 * Not a memory bound — a session holds two sockets and at most `CAPTION_PENDING_AUDIO_BYTES` of audio,
 * well under half a megabyte, so eight hold a few megabytes of an isolate's 128 — but a COST bound: each
 * open session is billed by the minute whether or not its words are worth reading, and more than eight
 * people talking over each other at once is not a conversation a caption strip can show. A room past it
 * is a room where `speaking` is noise (a dozen open microphones in a noisy hall), and the speakers past
 * the ceiling are counted and not captioned until a session closes.
 */
export const CAPTION_SESSION_CEILING = 8;

/** One second of the caption model's audio: mono, 16-bit, 48 kHz. */
export const CAPTION_AUDIO_BYTES_PER_SECOND = 48_000 * 2;

/**
 * THE MOST AUDIO A SESSION HOLDS WHILE ITS MODEL STREAM OPENS. The routing service starts sending as
 * soon as its adapter dials, and the model's socket may still be opening; two seconds is the opening
 * with room, and holding it keeps the first words of the turn. Past it the OLDEST audio is dropped and
 * counted: the session never grows past this however slow the model is to answer.
 */
export const CAPTION_PENDING_AUDIO_BYTES = 2 * CAPTION_AUDIO_BYTES_PER_SECOND;

/** Milliseconds of caption audio in this many bytes. */
export function captionAudioMilliseconds(bytes: number): number {
  return Math.floor((bytes * 1000) / CAPTION_AUDIO_BYTES_PER_SECOND);
}

// ---------------------------------------------------------------------------------------------
// How fast words go out
// ---------------------------------------------------------------------------------------------

/**
 * HOW OFTEN ONE SPEAKER'S INTERIM CAPTION MAY BE SENT. The model revises its guess at what is being said
 * several times a second, and every revision sent is one frame to every socket in the room — three
 * hundred of them in a full one. So interims are COALESCED: at most one a speaker per half second, the
 * latest guess kept and sent when the window closes, the earlier ones never sent at all. Half a second
 * keeps a caption visibly live; a final caption is never held by it.
 */
export const CAPTION_INTERIM_INTERVAL_MILLISECONDS = 500;

/**
 * HOW MANY CAPTION FRAMES THE WHOLE ROOM MAY BE SENT IN A SECOND, every speaker together — the budget
 * every caption spends from before it reaches a socket. Every socket receives every caption, so a bound
 * on the room is a bound on each socket.
 *
 * Ten is half the twenty a second a browser may itself send (`FRAME_BUDGET_PER_SECOND` in the protocol
 * package), so captions never ask a browser to read faster than it is allowed to write; and it is what
 * two speakers' interims at the interval above, with their finals, need. An interim that finds the
 * budget spent is held as its speaker's latest guess and goes at the next window; a FINAL spends from it
 * too but is never held or dropped, because nothing later restates it.
 */
export const CAPTION_FRAME_BUDGET_PER_SECOND = 10;

/** The room's caption budget as the captioner holds it: what is left, and when that was measured. */
export interface CaptionFrameBudget {
  readonly tokens: number;
  readonly measuredAt: number;
}

/** A full budget, measured now. */
export function freshCaptionFrameBudget(now: number): CaptionFrameBudget {
  return { tokens: CAPTION_FRAME_BUDGET_PER_SECOND, measuredAt: now };
}

/**
 * Spends one caption's worth of the room's budget, answering whether it may go and what is left.
 *
 * Refilled by arithmetic on the time since it was last measured, never by a timer, and never above one
 * second's worth. A final always goes: it takes a token when there is one and goes without when there
 * is not, so a burst of finals is late by nothing and leaves the interims behind it to wait.
 */
export function spendCaptionFrameBudget(
  budget: CaptionFrameBudget,
  now: number,
  final: boolean,
): { readonly allowed: boolean; readonly budget: CaptionFrameBudget } {
  const refilled = Math.min(
    CAPTION_FRAME_BUDGET_PER_SECOND,
    budget.tokens + (Math.max(0, now - budget.measuredAt) * CAPTION_FRAME_BUDGET_PER_SECOND) / 1000,
  );
  if (refilled >= 1) {
    return { allowed: true, budget: { tokens: refilled - 1, measuredAt: now } };
  }
  return { allowed: final, budget: { tokens: refilled, measuredAt: now } };
}

/**
 * When an interim caption for a speaker whose last one went out at `lastSentAt` may go: now, or the
 * instant its window closes. A speaker who has sent none may go now.
 */
export function interimDueAt(lastSentAt: number | null, now: number): number {
  if (lastSentAt === null) return now;
  return Math.max(now, lastSentAt + CAPTION_INTERIM_INTERVAL_MILLISECONDS);
}

// ---------------------------------------------------------------------------------------------
// What the words may be
// ---------------------------------------------------------------------------------------------

/**
 * THE LONGEST CAPTION ON THE WIRE, in characters as a reader counts them. The model answers a stretch of a few seconds at a
 * time, which is a sentence or two; a thousand characters is several times that, and far inside the
 * frame a browser will read. A longer answer is cut, never refused: a caption is a display, and the
 * transcript is where the whole of what was said is kept.
 */
export const CAPTION_TEXT_MAXIMUM_CHARACTERS = 1_000;

// Control characters, and the bidirectional and invisible ones a caption would otherwise carry onto
// every screen in the room — the same families the filed document names are cleaned of.
const UNSAFE_CHARACTERS = /[\p{Cc}\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/gu;

// Characters as a reader sees them — a letter and its accents, a pair of surrogates — so a cut never
// leaves half of one on the screen.
const GRAPHEMES = new Intl.Segmenter("und", { granularity: "grapheme" });

/**
 * The words a caption carries: on one line, with control, bidirectional and invisible characters
 * removed, runs of space collapsed, and cut at `CAPTION_TEXT_MAXIMUM_CHARACTERS` characters as a reader
 * counts them — never inside one. Empty when nothing readable is left, which a caller does not send.
 */
export function captionText(words: string): string {
  const cleaned = words.replace(UNSAFE_CHARACTERS, " ").replace(/\s+/gu, " ").trim();
  let kept = 0;
  for (const { index } of GRAPHEMES.segment(cleaned)) {
    if (kept === CAPTION_TEXT_MAXIMUM_CHARACTERS) return cleaned.slice(0, index);
    kept += 1;
  }
  return cleaned;
}
