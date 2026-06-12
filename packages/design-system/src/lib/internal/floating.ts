import { mergeClasses } from "./merge-classes.ts";

/*
 * The internal floating/presence pattern (design spec, "Styling discipline"):
 * every Tier 3/4 floating part composes its content classes here — the z-index
 * scale and the data-state presence animations are defined ONCE, in this file,
 * and nowhere else.
 *
 * Bits UI v2 background (bits-ui.com/docs/transitions, bits-ui.com/docs/child-snippet):
 * content components carry a `data-state="open" | "closed"` attribute and keep the
 * element mounted until its CSS transition/animation completes, so presence
 * animations are plain CSS driven by `data-[state=…]` variants — the default
 * pattern. Svelte transitions (`forceMount` + `child` snippet + `{#if}`) remain
 * available per component, but the constants below are the house default.
 */

/**
 * FLOATING_WRAPPER_RULE — the two-level rule for Bits UI v2 floating content
 * (Combobox/DropdownMenu/Popover/Select/Tooltip/LinkPreview/Menubar and the
 * date pickers' Content parts).
 *
 * When a floating Content part uses the `child` snippet, Bits renders TWO
 * elements:
 *
 *   1. An outer wrapper that takes `{...wrapperProps}`. It carries the Floating
 *      UI positioning (inline top/left/transform). It must stay UNSTYLED —
 *      never give it classes, margins, transforms, or any positioning of its
 *      own, or anchoring breaks.
 *   2. The inner content element that takes `{...props}`. ALL styling —
 *      including the classes built by floatingContentClasses() — goes here.
 *
 * Exported as a constant so wrapper reviews and future lint messages can cite
 * one canonical statement of the rule.
 */
export const FLOATING_WRAPPER_RULE =
  "Floating content renders two elements: the outer wrapperProps element carries Floating UI " +
  "positioning and stays unstyled; every class goes on the inner props element.";

/**
 * The token z-index scale, as Tailwind utilities generated from the
 * `--z-index-*` theme namespace (@magna-carta/design-tokens, tokens/primitives/z-index.json).
 *
 * This map is the ONLY home for stacking order in the component layer: raw
 * `z-<number>` utilities are banned (design spec, "Styling discipline" — lint
 * arrives with the enforcement task), and Bits portals impose no z-index of
 * their own, so layering is owned entirely by these tokens.
 */
export const Z_LAYER_CLASSES = {
  dropdown: "z-dropdown",
  sticky: "z-sticky",
  overlay: "z-overlay",
  modal: "z-modal",
  toast: "z-toast",
} as const;

export type ZLayer = keyof typeof Z_LAYER_CLASSES;

/*
 * Presence animation constants — motion tokens only (duration-* and ease-* from the
 * generated theme; opacity/scale/translate values from Tailwind's token-resolved
 * scales — translate distances resolve the --spacing-* tokens). No arbitrary
 * values, no raw milliseconds.
 *
 * Every constant carries `motion-reduce:transition-none` — the STRUCTURAL
 * reduced-motion gate: under prefers-reduced-motion the state flip applies
 * instantly with no animation. CSS media queries cannot stop JS engines, so a
 * JS-side prefersReducedMotion scalar gate is still mandatory for JS-driven
 * animation (design spec, "Satellite dependencies" — Motion); it ships with the
 * first JS-driven animation, which does not exist yet.
 */

/** Fade in/out. The default for tooltips and other low-emphasis surfaces. */
export const PRESENCE_FADE =
  "transition-opacity duration-fast ease-standard motion-reduce:transition-none " +
  "data-[state=open]:opacity-100 data-[state=closed]:opacity-0";

/** Fade combined with a subtle scale — the standard popover/menu presence. */
export const PRESENCE_SCALE_FADE =
  "transition duration-fast ease-standard motion-reduce:transition-none " +
  "data-[state=open]:opacity-100 data-[state=open]:scale-100 " +
  "data-[state=closed]:opacity-0 data-[state=closed]:scale-95";

/** Slide down into place from above, fading. For surfaces anchored to a top edge. */
export const PRESENCE_SLIDE_FROM_TOP =
  "transition duration-normal ease-standard motion-reduce:transition-none " +
  "data-[state=open]:translate-y-0 data-[state=open]:opacity-100 " +
  "data-[state=closed]:-translate-y-8 data-[state=closed]:opacity-0";

/** Slide up into place from below, fading. For surfaces anchored to a bottom edge. */
export const PRESENCE_SLIDE_FROM_BOTTOM =
  "transition duration-normal ease-standard motion-reduce:transition-none " +
  "data-[state=open]:translate-y-0 data-[state=open]:opacity-100 " +
  "data-[state=closed]:translate-y-8 data-[state=closed]:opacity-0";

/** Slide right into place from the left, fading. For surfaces anchored to a left edge. */
export const PRESENCE_SLIDE_FROM_LEFT =
  "transition duration-normal ease-standard motion-reduce:transition-none " +
  "data-[state=open]:translate-x-0 data-[state=open]:opacity-100 " +
  "data-[state=closed]:-translate-x-8 data-[state=closed]:opacity-0";

/** Slide left into place from the right, fading. For surfaces anchored to a right edge. */
export const PRESENCE_SLIDE_FROM_RIGHT =
  "transition duration-normal ease-standard motion-reduce:transition-none " +
  "data-[state=open]:translate-x-0 data-[state=open]:opacity-100 " +
  "data-[state=closed]:translate-x-8 data-[state=closed]:opacity-0";

/**
 * The canonical content-class builder for floating parts (Tier 3/4): composes
 * the token z-layer, the presence constants, and any caller classes through
 * mergeClasses, so later inputs win conflicts and duplicates collapse.
 *
 * Apply the result to the INNER content element only — see FLOATING_WRAPPER_RULE.
 */
export function floatingContentClasses(layer: ZLayer, ...presence: string[]): string {
  return mergeClasses(Z_LAYER_CLASSES[layer], ...presence);
}
