/*
 * Which translation engine a request gets.
 *
 * ONE ENGINE TODAY, SWITCHED ON BY ITS KEY. With GOOGLE_TRANSLATE_API_KEY set (from the Secrets
 * Store, or a per-Worker secret of the same name), every translation goes to Google Cloud Translation
 * and Google bills for it. Without it the port answers `not-configured` to everything and the
 * Translate screen says translation is not set up. Deleting the key switches it off with nothing
 * else changed, the shape the address-lookup engine takes with its Google key
 * (address-lookup/address-lookup-engine.ts).
 *
 * The key is a separate one from GOOGLE_PLACES_API_KEY on purpose, though both may live in the same
 * Google Cloud project: each is restricted to its own API and can be revoked without the other.
 */
import { googleTranslationPort } from "@magna-carta/translation/google";
import { unconfiguredTranslationPort, type TranslationPort } from "@magna-carta/translation/port";
import type { Bindings } from "../bindings.ts";

export function translationEngineConnected(
  env: Pick<Bindings, "GOOGLE_TRANSLATE_API_KEY">,
): boolean {
  return (env.GOOGLE_TRANSLATE_API_KEY?.trim() ?? "") !== "";
}

export function resolveTranslationPort(
  env: Pick<Bindings, "GOOGLE_TRANSLATE_API_KEY">,
): TranslationPort {
  const key = env.GOOGLE_TRANSLATE_API_KEY?.trim() ?? "";
  return key === "" ? unconfiguredTranslationPort() : googleTranslationPort(key);
}
