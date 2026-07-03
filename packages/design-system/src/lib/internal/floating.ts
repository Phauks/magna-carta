import { mergeClasses } from "./merge-classes.ts";

/*
 * The internal floating/presence pattern: every Tier 3/4 floating part composes
 * its content classes here — the z-index scale and the data-state presence
 * animations are defined ONCE, in this file, and nowhere else, so no two
 * floating surfaces can drift apart in stacking or motion.
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
 * `z-<number>` utilities are banned (an off-scale layer would stack
 * unpredictably against every existing surface), and Bits portals impose no
 * z-index of their own, so layering is owned entirely by these tokens.
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
 * Presence recipe classes — each names a CSS keyframe-animation recipe (keyframes in
 * styles/animations.css, recipe in components.css) keyed on the Bits `data-state` attribute.
 * A keyframe animation, not a transition, so each surface animates IN on mount as well as OUT
 * (a transition has nothing to animate from on first mount, so the surface would "pop" in and only
 * animate on close). Durations, easings, and reduced motion are all handled token-by-token in the
 * recipe; under prefers-reduced-motion the recipe collapses the duration to instant.
 */

/** Fade in/out. The default for tooltips and other low-emphasis surfaces. */
export const PRESENCE_FADE = "mc-presence-fade";

/** Fade combined with a subtle scale — the standard popover/menu presence. */
export const PRESENCE_SCALE_FADE = "mc-presence-scale-fade";

/*
 * Edge-pinned PANEL slides (drawers/sheets) are NOT here — they carry their own per-side recipe
 * (mc-sheet-content in components.css, keyframes in styles/animations.css). Same keyframe-animation
 * rationale as the constants above: a transition has nothing to animate from on first mount, so the
 * panel would "pop" in and only slide out.
 */

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
