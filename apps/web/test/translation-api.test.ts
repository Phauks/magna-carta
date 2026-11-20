// @node-runtime
/*
 * The pure parts of the translation client: naming a language, the choices a picker offers, the
 * characters a translation sends, and the text Copy puts on the clipboard.
 */
import { describe, expect, it } from "vitest";
import {
  charactersOf,
  languageChoices,
  languageName,
  translationText,
} from "../src/lib/translation/translation-api.ts";

const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
];

describe("the translation client", () => {
  it("names a language from the list, and falls back to its code", () => {
    expect(languageName(LANGUAGES, "es")).toBe("Spanish");
    expect(languageName(LANGUAGES, "xx")).toBe("xx");
    expect(languageName(LANGUAGES, null)).toBe("");
  });

  it("offers every language as a choice a member can find by its code", () => {
    expect(languageChoices(LANGUAGES)).toEqual([
      { value: "en", label: "English", keywords: ["en"] },
      { value: "es", label: "Spanish", keywords: ["es"] },
    ]);
  });

  it("counts what would be sent, without the blank edges", () => {
    expect(charactersOf("  Hola  ")).toBe(4);
    expect(charactersOf("   ")).toBe(0);
  });

  it("copies the translation as paragraphs separated by a blank line", () => {
    expect(
      translationText({
        passages: [
          { original: "Hola", translation: "Hello" },
          { original: "Adiós", translation: "Goodbye" },
        ],
        source: "es",
        target: "en",
        engine: "google",
        characters: 9,
      }),
    ).toBe("Hello\n\nGoodbye");
  });
});
