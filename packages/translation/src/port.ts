/*
 * TranslationPort: the one way a piece of text is sent to a translation engine. Two operations: turn
 * a list of passages into another language (`translate`), and list the languages the engine knows
 * (`languages`). Every operation returns a typed outcome and never throws, the same discipline as the
 * address-lookup port, so a caller pattern-matches rather than catches.
 *
 * WHAT CROSSES IS A CLIENT'S TEXT. A pasted letter is privileged content, and it reaches whatever
 * serves this port. So an implementation stores none of it: no log line carrying the text or the
 * translation, no cache keyed on it, nothing held between calls. A failure's `detail` is a fixed
 * sentence and at most a status code.
 *
 * PASSAGES IN, PASSAGES OUT, IN THE SAME ORDER. The caller splits the text (by paragraph, today) and
 * gets back one translation per passage, so the screen can show each paragraph beside its own
 * translation. An engine that answered a different count would break that pairing silently, so an
 * adapter that cannot keep it answers a failure instead.
 *
 * THIS IS MACHINE OUTPUT AND NOTHING HERE SAYS OTHERWISE. A result names the engine that produced it
 * so the record of a run can say what saw the text. It carries no score and no claim of accuracy.
 */

/** The engines a translation can come from. Recorded on every run. */
export type TranslationEngine = "google";

export interface TranslateInput {
  /** The passages to translate, in order. None is empty. */
  readonly passages: readonly string[];
  /** The language to translate into, as the engine's language code (`en`, `es`, `zh-TW`). */
  readonly target: string;
  /** The language the passages are in. Absent, the engine detects it. */
  readonly source?: string;
}

export interface Translation {
  /** One per passage, in the order they were sent. */
  readonly passages: readonly string[];
  /** The language the engine found, when the caller did not name one. */
  readonly detectedSource?: string;
  readonly engine: TranslationEngine;
}

export interface Language {
  readonly code: string;
  /** The language's name in the display language asked for. */
  readonly name: string;
}

/**
 * Why a call did not answer. `not-configured`: no engine is set up in this deployment.
 * `refused`: the engine turned this request down (an unknown language, a revoked key, a used-up
 * quota). `too-long`: one passage is larger than the engine takes in one request. `unavailable`: the
 * engine did not answer, or answered something unreadable.
 */
export type TranslationFailureReason = "not-configured" | "refused" | "too-long" | "unavailable";

export interface TranslationFailure {
  readonly ok: false;
  readonly reason: TranslationFailureReason;
  readonly detail: string;
}

export type TranslateResult =
  | { readonly ok: true; readonly value: Translation }
  | TranslationFailure;
export type LanguagesResult =
  | { readonly ok: true; readonly value: readonly Language[] }
  | TranslationFailure;

export interface TranslationPort {
  translate(input: TranslateInput): Promise<TranslateResult>;
  languages(displayLanguage: string): Promise<LanguagesResult>;
}

export function translationFailure(
  reason: TranslationFailureReason,
  detail: string,
): TranslationFailure {
  return { ok: false, reason, detail };
}

/**
 * The port a deployment with no engine gets: it answers `not-configured` to everything and reaches
 * nothing, so a screen built on it shows the feature as not set up rather than failing.
 */
export function unconfiguredTranslationPort(): TranslationPort {
  const failure = translationFailure("not-configured", "No translation engine is set up.");
  return {
    translate: () => Promise.resolve(failure),
    languages: () => Promise.resolve(failure),
  };
}

/**
 * Splits pasted text into passages at blank lines, which is how a letter separates its paragraphs.
 * Line breaks inside a paragraph are kept, so an address block stays an address block. Passages that
 * are only whitespace are dropped: there is nothing in them to translate or to pay for.
 */
export function passagesOf(text: string): string[] {
  return text
    .replace(/\r\n?/gu, "\n")
    .split(/\n[ \t]*\n+/u)
    .map((passage) => passage.trim())
    .filter((passage) => passage !== "");
}
