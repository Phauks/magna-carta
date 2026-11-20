/*
 * The Google adapter: TranslationPort over Google Cloud Translation, the Basic (v2) API.
 *
 * WHY BASIC. The owner asked on 2026-11-19 for Google Translate. Basic is the version that takes an
 * API key, which the platform keeps in the Secrets Store like its other Google key; Advanced (v3)
 * takes only a service account's signed token. Basic and Advanced use the same translation model for
 * text and cost the same. What Advanced adds that matters here is a regional endpoint that keeps the
 * text in one region; Basic is served globally. Moving to Advanced is a new adapter behind this same
 * port.
 *
 * WHAT GOOGLE SAYS IT DOES WITH THE TEXT (its Cloud Translation data-usage page, read 2026-11-19): the
 * text is held in memory only while it is translated, is not used to train Google's models, and is not
 * shared with anyone else. That is Google's statement, not something this code can check.
 *
 * THE KEY TRAVELS IN A HEADER, THE TEXT IN A BODY. Neither is ever in a URL, and no failure carries
 * either: a failure's `detail` is a fixed sentence and at most the status code.
 *
 * ONE REQUEST HOLDS AT MOST 128 PASSAGES AND 100,000 BYTES (Google's limits for Basic). Passages are
 * packed into as few requests as fit under a lower byte ceiling, sent one after another, and joined
 * back in order. A single passage over the ceiling is refused as `too-long` rather than cut, because a
 * cut sentence translates into something the original did not say.
 *
 * Pure: `fetch` is injected, nothing reads `env`.
 */
import {
  translationFailure,
  type Language,
  type LanguagesResult,
  type TranslateInput,
  type TranslateResult,
  type TranslationFailure,
  type TranslationPort,
} from "./port.ts";

/** The fetch this adapter calls through, injected so a test never reaches the network. */
export type GoogleFetch = (url: string, init?: RequestInit) => Promise<Response>;

const TRANSLATE_ENDPOINT = "https://translation.googleapis.com/language/translate/v2";
const LANGUAGES_ENDPOINT = "https://translation.googleapis.com/language/translate/v2/languages";

/** Google's own ceiling on passages per request. */
export const MOST_PASSAGES_PER_REQUEST = 128;
/** Under Google's 100,000-byte request ceiling, with room for the JSON around the passages. */
export const MOST_BYTES_PER_REQUEST = 60_000;

/** A translation of a few pages takes a few seconds; one that has not answered by now will not. */
const REQUEST_TIMEOUT_MILLISECONDS = 20_000;

/** A language code is letters, digits and `-`, as `en`, `zh-TW` or `mni-Mtei`. */
export const LANGUAGE_CODE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;

const encoder = new TextEncoder();

function bytesOf(text: string): number {
  return encoder.encode(text).byteLength;
}

/**
 * Packs passages, in order, into the fewest batches under both ceilings. Answers `undefined` when one
 * passage alone is over the byte ceiling.
 */
export function batchesOf(passages: readonly string[]): string[][] | undefined {
  const batches: string[][] = [];
  let current: string[] = [];
  let currentBytes = 0;
  for (const passage of passages) {
    const size = bytesOf(passage);
    if (size > MOST_BYTES_PER_REQUEST) return undefined;
    if (
      current.length === MOST_PASSAGES_PER_REQUEST ||
      currentBytes + size > MOST_BYTES_PER_REQUEST
    ) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(passage);
    currentBytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

type Fetched = { readonly ok: true; readonly body: unknown } | TranslationFailure;

async function request(
  fetchImplementation: GoogleFetch,
  url: string,
  init: RequestInit,
): Promise<Fetched> {
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    });
  } catch {
    return translationFailure("unavailable", "The translation service did not answer in time.");
  }
  if (!response.ok) {
    // 400 is a language Google does not know or a malformed request; 403 a key that is wrong,
    // restricted away from this API, or out of quota; 429 too many requests. Each is Google turning
    // the request down, which no retry of the same request fixes.
    const refused = response.status === 400 || response.status === 403 || response.status === 429;
    return translationFailure(
      refused ? "refused" : "unavailable",
      `The translation service refused the request (status ${String(response.status)}).`,
    );
  }
  try {
    return { ok: true, body: await response.json() };
  } catch {
    return translationFailure(
      "unavailable",
      "The translation service answered with something that was not JSON.",
    );
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function listOf(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(recordOf) : [];
}

function headers(apiKey: string): Record<string, string> {
  return { "content-type": "application/json", "x-goog-api-key": apiKey };
}

export function googleTranslationPort(
  apiKey: string,
  fetchImplementation: GoogleFetch = (url, init) => fetch(url, init),
): TranslationPort {
  return {
    async translate(input: TranslateInput): Promise<TranslateResult> {
      const batches = batchesOf(input.passages);
      if (batches === undefined) {
        return translationFailure("too-long", "One paragraph is too long to translate at once.");
      }
      const translated: string[] = [];
      let detectedSource: string | undefined;
      for (const batch of batches) {
        const fetched = await request(fetchImplementation, TRANSLATE_ENDPOINT, {
          method: "POST",
          headers: headers(apiKey),
          body: JSON.stringify({
            q: batch,
            target: input.target,
            ...(input.source === undefined ? {} : { source: input.source }),
            // Plain text in, plain text out. The default, html, escapes an ampersand or a quote
            // into an entity the screen would then show.
            format: "text",
            model: "nmt",
          }),
        });
        if (!fetched.ok) return fetched;
        const answers = listOf(recordOf(recordOf(fetched.body).data).translations);
        if (answers.length !== batch.length) {
          return translationFailure(
            "unavailable",
            "The translation service answered a different number of paragraphs than it was sent.",
          );
        }
        for (const answer of answers) {
          const text = answer.translatedText;
          if (typeof text !== "string") {
            return translationFailure(
              "unavailable",
              "The translation service answered a paragraph with no text.",
            );
          }
          translated.push(text);
          const detected = answer.detectedSourceLanguage;
          if (detectedSource === undefined && typeof detected === "string" && detected !== "") {
            detectedSource = detected;
          }
        }
      }
      return {
        ok: true,
        value: {
          passages: translated,
          ...(input.source === undefined && detectedSource !== undefined ? { detectedSource } : {}),
          engine: "google",
        },
      };
    },

    async languages(displayLanguage: string): Promise<LanguagesResult> {
      const url = `${LANGUAGES_ENDPOINT}?target=${encodeURIComponent(displayLanguage)}&model=nmt`;
      const fetched = await request(fetchImplementation, url, {
        method: "GET",
        headers: { "x-goog-api-key": apiKey },
      });
      if (!fetched.ok) return fetched;
      const languages: Language[] = [];
      for (const entry of listOf(recordOf(recordOf(fetched.body).data).languages)) {
        const code = entry.language;
        const name = entry.name;
        if (typeof code === "string" && LANGUAGE_CODE.test(code)) {
          languages.push({ code, name: typeof name === "string" && name !== "" ? name : code });
        }
      }
      if (languages.length === 0) {
        return translationFailure("unavailable", "The translation service listed no languages.");
      }
      return {
        ok: true,
        value: languages.toSorted((left, right) => left.name.localeCompare(right.name)),
      };
    },
  };
}
