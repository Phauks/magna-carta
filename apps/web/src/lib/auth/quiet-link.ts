/*
 * The quiet inline-link register: a text link carrying no control chrome, for the side doors that
 * sit beside a control — resetting a password, registering, reaching for a recovery code.
 *
 * It is one literal string rather than an assembled one for two reasons. The anchors and the
 * buttons-that-read-as-links cannot drift apart if they share a constant; and Tailwind's scanner
 * only sees class names it can read in source, so a composed string would silently ship unstyled.
 */
export const QUIET_LINK =
  "rounded-sm text-sm text-text-link hover:underline focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2";
