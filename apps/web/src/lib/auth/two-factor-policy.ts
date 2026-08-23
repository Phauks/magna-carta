/*
 * The two-factor numbers the sign-in surface has to SAY out loud, in one place.
 *
 * Nothing user-facing may state a duration or a length as prose: "for 30 days", "six digits" and
 * "every 30 seconds" are all promises about server behaviour, and a promise typed into a sentence
 * drifts silently the day the server changes. Every such number is derived from a constant here and
 * interpolated into the copy, so a change is one edit and the sentence follows it.
 *
 * These mirror the two-factor configuration in apps/api-worker/src/auth.ts, which mounts the plugin on
 * its defaults (trusted-device window, code period, and code length are all left unset there, so the
 * library defaults apply). If that call ever passes explicit options, these move with it — they are
 * the browser's copy of a server-side fact, and there is no endpoint that publishes it.
 */

/** How long a trusted device skips the second factor, in seconds. */
export const TRUSTED_DEVICE_SECONDS = 2_592_000;

const SECONDS_PER_DAY = 86_400;

/** The same window in whole days — the unit the checkbox label speaks in. */
export const TRUSTED_DEVICE_DAYS = TRUSTED_DEVICE_SECONDS / SECONDS_PER_DAY;

/** How many digits an authenticator code has; also how many cells the code entry renders. */
export const VERIFICATION_CODE_LENGTH = 6;

/** How often an authenticator code rotates, in seconds. */
export const VERIFICATION_CODE_PERIOD_SECONDS = 30;
