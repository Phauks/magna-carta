/*
 * Translation, for every surface that offers it: the Translate screen and the Translate line under a
 * text message, a note or an email. One module so they all ask the same question the same way.
 *
 * Calls `translation.translate` and `translation.languages` through the generated client. The text
 * goes in the request body and is kept nowhere, here or on the server; the firm's log records that a
 * run happened, never what it said.
 *
 * TRANSLATE IS NOT AI (owner ruling, 2026-11-20). It is Google's translation service, said so on
 * every surface that uses it with a link to Google Translate itself, and none of the AI settings
 * reach it.
 */
import {
  translationLanguagesOptions,
  translationTranslate,
  type TranslateResponse,
  type TranslationLanguage,
} from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";
import { queryClient, SESSION_STABLE } from "$lib/api/screen-data.ts";
import type { ChoiceOption } from "$lib/components/choice-picker.ts";

export type { TranslateResponse, TranslationLanguage } from "@magna-carta/api-client";

/** The permission every translating surface is gated on. Every default role holds it. */
export const TRANSLATION_PERMISSION = "tools:translation";

/** The most text one translation takes, matching the route's own limit. */
export const MOST_CHARACTERS = 20_000;

/** Google Translate itself, which every translating surface links to. Nothing typed rides along. */
export const GOOGLE_TRANSLATE_URL = "https://translate.google.com/";

/** Translate `text` into `target`. Absent `source`, Google says what language it found. */
export async function translateText(request: {
  readonly text: string;
  readonly target: string;
  readonly source?: string;
  readonly matterId?: string;
}): Promise<ApiOutcome<TranslateResponse>> {
  try {
    const { data } = await translationTranslate({
      body: {
        text: request.text,
        target: request.target,
        ...(request.source === undefined ? {} : { source: request.source }),
        ...(request.matterId === undefined ? {} : { matterId: request.matterId }),
      },
      throwOnError: true,
    });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

/**
 * The languages Google translates between, named in English. Reference data, the same for every
 * firm: read once a session and shared by every surface that offers a language list.
 */
export async function readLanguages(): Promise<ApiOutcome<readonly TranslationLanguage[]>> {
  try {
    const answer = await queryClient.fetchQuery({
      ...translationLanguagesOptions({ query: { display: "en" } }),
      staleTime: SESSION_STABLE,
    });
    return { kind: "ok", value: answer.languages };
  } catch (error) {
    return outcomeOf(error);
  }
}

/** The language list as choices for the picker. */
export function languageChoices(languages: readonly TranslationLanguage[]): ChoiceOption[] {
  return languages.map((language) => ({
    value: language.code,
    label: language.name,
    keywords: [language.code],
  }));
}

/** A language's name from the list, or its code when the list does not have it. */
export function languageName(
  languages: readonly TranslationLanguage[],
  code: string | null | undefined,
): string {
  if (code === null || code === undefined || code === "") return "";
  return languages.find((language) => language.code === code)?.name ?? code;
}

const REMEMBERED_TARGET_KEY = "magna-carta.translation.target";

/**
 * The language a member last translated into, or their browser's own language the first time.
 * Remembered in this browser only: it is a convenience, not a setting.
 */
export function rememberedTarget(): string {
  try {
    const kept = globalThis.localStorage?.getItem(REMEMBERED_TARGET_KEY);
    if (kept !== null && kept !== undefined && kept !== "") return kept;
  } catch {
    // Storage refused (a private window); fall through to the browser's language.
  }
  const browser = globalThis.navigator?.language ?? "en";
  return browser.split("-")[0] || "en";
}

export function rememberTarget(code: string): void {
  try {
    globalThis.localStorage?.setItem(REMEMBERED_TARGET_KEY, code);
  } catch {
    // Storage refused; the next visit starts from the browser's language again.
  }
}

/** The characters a translation of `text` would send, which is what Google charges by. */
export function charactersOf(text: string): number {
  return text.trim().length;
}

/** The translation as one block of text, paragraphs separated by a blank line, for Copy. */
export function translationText(result: TranslateResponse): string {
  return result.passages.map((passage) => passage.translation).join("\n\n");
}
