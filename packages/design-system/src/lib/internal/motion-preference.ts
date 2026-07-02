/*
 * The ONE source of truth for "how much motion right now" — the JS-side reader of the motion
 * axis. All three motion lanes consult it: CSS keyframes/transitions comply structurally (the
 * token overlay re-points the duration ladder; recipes never call this), View Transitions
 * (view-transition.ts) and JS-driven signature motion (signature-motion.ts) call it because a
 * media query cannot stop a JS engine.
 *
 * Resolution: the `data-motion` attribute on <html> (set by the boot script / theme-preference
 * seam from the persisted user preference) wins; when absent, the OS `prefers-reduced-motion`
 * signal resolves to reduced/full. The result is the RESOLVED three-level value — "system" never
 * escapes this module.
 */

export type ResolvedMotionLevel = "full" | "reduced" | "off";

export function resolvedMotionLevel(): ResolvedMotionLevel {
  if (typeof document !== "undefined") {
    const attribute = document.documentElement.dataset["motion"];
    if (attribute === "reduced" || attribute === "off") return attribute;
    if (attribute === "full") return "full";
  }
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return "reduced";
  }
  return "full";
}

/** True when large/decorative animation should not play (reduced or off). */
export function prefersReducedMotion(): boolean {
  return resolvedMotionLevel() !== "full";
}
