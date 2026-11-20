import { z } from "zod";
import { LANGUAGE_CODE } from "./google.ts";

// What the translation API accepts and answers, as plain zod named with `.meta({ id })`, which the
// contract emitter reads as the component's name (docs/conventions/api.md, _Where a contract shape
// lives_). The route modules in apps/api-worker declare their routes over these.
//
// THE TEXT TRAVELS IN A BODY, never a path or a query string: it is a client's letter, and a URL is
// what request logs, proxies and browser history keep.

/**
 * The most a member may paste at once: about eight pages of a letter. A longer document is document
 * translation, which runs as a background job rather than inside one request.
 */
export const MOST_CHARACTERS_PER_TRANSLATION = 20_000;

const LanguageCode = z.string().regex(LANGUAGE_CODE).max(16);

export const TranslateRequest = z
  .object({
    text: z.string().min(1).max(MOST_CHARACTERS_PER_TRANSLATION),
    target: LanguageCode,
    source: LanguageCode.optional().meta({
      description: "The language the text is in. Absent, the engine detects it.",
    }),
    matterId: z.string().min(1).optional().meta({
      description: "The matter the translation is for, recorded on the firm's log of the run.",
    }),
  })
  .meta({ id: "TranslateRequest" });

export const TranslatedPassage = z
  .object({
    original: z.string(),
    translation: z.string(),
  })
  .meta({ id: "TranslatedPassage" });

export const TranslateResponse = z
  .object({
    passages: z.array(TranslatedPassage).meta({
      description: "One per paragraph of the text, in order, each beside its translation.",
    }),
    source: z.string().nullable().meta({
      description: "The language the text was in: the one asked for, or the one the engine found.",
    }),
    target: z.string(),
    engine: z.enum(["google"]),
    characters: z.number().int().nonnegative().meta({
      description: "The characters sent to the engine, which is what it charges by.",
    }),
  })
  .meta({ id: "TranslateResponse" });

export const TranslationLanguage = z
  .object({ code: z.string(), name: z.string() })
  .meta({ id: "TranslationLanguage" });

export const TranslationLanguagesResponse = z
  .object({ languages: z.array(TranslationLanguage) })
  .meta({ id: "TranslationLanguagesResponse" });
