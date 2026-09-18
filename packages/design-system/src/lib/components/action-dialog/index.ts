/*
 * ActionDialog — the one panel an act is asked for in, exported as a single component rather than
 * the house namespace shape. The namespace shape exists so a caller can compose a component's
 * parts; this one deliberately has no parts to compose. A caller hands it a heading, two snippets
 * and one verb, and every panel in the product is therefore the same panel.
 * tooling/lint-one-ui holds the line.
 */
export { default } from "./action-dialog.svelte";
export { default as ActionDialog } from "./action-dialog.svelte";
export {
  traitsOf,
  widthClass,
  DISMISS_LABEL,
  LEAVE_LABEL,
  type KindTraits,
} from "./action-dialog-model.ts";
export type { ActingKind, ActionDialogKind, ActionDialogWidth, ActionOutcome } from "./types.ts";
