/**
 * The text-like input types Input dresses — the closed set its recipe is designed for. Colocated
 * in a plain module (not the .svelte) so the type can be re-exported and imported by plain tsc;
 * a `type` re-exported from a `*.svelte` file resolves only under svelte-check.
 *
 * Excluded on purpose: `file` (its own FileInput component), and checkbox/radio/range/color and
 * the button types (they render their own widgets the text-field recipe can't dress).
 */
export type InputType =
  | "text"
  | "email"
  | "password"
  | "search"
  | "tel"
  | "url"
  | "number"
  | "date"
  | "datetime-local"
  | "month"
  | "week"
  | "time";
