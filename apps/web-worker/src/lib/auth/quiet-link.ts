/*
 * The quiet inline-link register: a text link carrying no control chrome, for the side doors that
 * sit beside a control — resetting a password, registering, reaching for a recovery code.
 *
 * It is one literal string rather than an assembled one for two reasons. The anchors and the
 * buttons-that-read-as-links cannot drift apart if they share a constant; and Tailwind's scanner
 * only sees class names it can read in source, so a composed string would silently ship unstyled.
 *
 * `cursor-pointer` is carried here rather than assumed: these render as bare `<button>` elements to
 * keep the side doors out of the tab order's control chrome, and Tailwind v4's preflight sets
 * `cursor: default` on a button. The design system's own Button recipe sets the pointer itself, so
 * only the raw-class links that bypass that recipe — these — have to say it.
 */
export const QUIET_LINK =
  "cursor-pointer rounded-sm text-sm text-text-link hover:underline focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2";
