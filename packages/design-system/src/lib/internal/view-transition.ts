/*
 * View-transition helper. Runs a DOM-mutating state change inside the browser's View Transitions
 * API so the change between two LAYOUTS is tweened on the compositor — the browser snapshots before
 * and after and animates the snapshots with GPU transforms, instead of re-laying-out every frame.
 *
 * Why this exists: animating a layout property (an element's `width`, a grid track, `margin`) repaints
 * its moving edge every frame, and at a fractional device-pixel ratio (e.g. Windows 150% scaling) the
 * sub-pixel edge — a 1px border between a rail and the work canvas — shimmers/tears along the seam.
 * Compositing the transition removes that whole class of artifact: the seam is sampled by the GPU,
 * not re-rasterized. (The sidebar collapse is the first consumer; see sidebar.css.)
 *
 * Graceful fallback: when the API is absent OR the user prefers reduced motion, the update is applied
 * synchronously with no animation — which is exactly what a reduced-motion user wants, and keeps the
 * state change instant where the API can't help.
 */

import { prefersReducedMotion } from "./motion-preference.ts";

/** The subset of the View Transitions API we depend on (not yet in every TS DOM lib). */
type StartViewTransition = (callback: () => void | Promise<void>) => {
  finished: Promise<unknown>;
};

/**
 * Apply `update` (a reactive-state mutation) inside a View Transition when supported and motion is
 * allowed; otherwise apply it synchronously. The mutation is deferred to the transition's capture
 * step when animating, so callers should not rely on the change having taken effect synchronously.
 *
 * `marker` (optional) names the transition on <html> as `data-mc-view-transition` for its
 * lifetime, so CSS can style the transition pseudo-elements PER DIRECTION — a width collapse and
 * a width expand need opposite snapshot stacking (see the sidebar rules in styles/animations.css),
 * and the pseudo-elements themselves carry no state to select on. Cleared when the transition
 * finishes; a marker is only removed by the transition that set it, so back-to-back transitions
 * (rapid toggling) cannot strip each other's marker.
 */
export function runViewTransition(update: () => void, marker?: string): void {
  const start = (document as Document & { startViewTransition?: StartViewTransition })
    .startViewTransition;
  if (typeof start !== "function" || prefersReducedMotion()) {
    update();
    return;
  }
  const root = document.documentElement;
  if (marker !== undefined) {
    root.dataset.mcViewTransition = marker;
  }
  const transition = start.call(document, update);
  if (marker !== undefined) {
    const clear = (): void => {
      if (root.dataset.mcViewTransition === marker) {
        delete root.dataset.mcViewTransition;
      }
    };
    transition.finished.then(clear, clear);
  }
}
