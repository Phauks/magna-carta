/*
 * Wires the work-canvas scroll policy (canvas-scroll.ts) into SvelteKit's navigation lifecycle
 * with the concrete dependencies: SvelteKit's before/afterNavigate, the DOM (history index and
 * hash-target lookup), and the tick-then-frame layout wait.
 *
 * Why this exists: the shell's <main> is the only scroll region — the top bar and sidebar are
 * fixed — so the window never scrolls. SvelteKit's built-in restoration scrolls the window (a
 * no-op here) and never touches main.scrollTop, which then carries over from the previous page.
 * The policy resets the canvas to the top on a forward navigation and restores the saved offset on
 * back/forward, keyed per history entry.
 *
 * The one subtlety that makes restore work: `afterNavigate` runs while <main> still holds the
 * OUTGOING page's DOM, so its scrollHeight is the old page's. Assigning a restore offset then is
 * clamped against the wrong height (the reader lands short). `afterLayout` below therefore waits a
 * tick — for the framework to swap in the new page — and then a frame — for the browser to lay it
 * out — before applying, so the offset is measured against the correct height. The assignment is a
 * plain instant write to scrollTop; there is no smooth scroll and nothing animates.
 */
import { afterNavigate, beforeNavigate } from "$app/navigation";
import { tick } from "svelte";
import { registerCanvasScrollRestoration, type ScrollableCanvas } from "./canvas-scroll.ts";

// SvelteKit stamps each history entry with a stable index under this key (its client runtime uses
// the same value to key its own window-scroll restoration). Reading it lets us save and restore a
// canvas offset per entry, surviving back/forward. If it is ever absent we degrade to a plain
// reset — the primary bug (carried-over scroll) still stays fixed; only back-restore is skipped.
const SVELTEKIT_HISTORY_INDEX_KEY = "sveltekit:history";

function currentHistoryIndex(): number | null {
  const state = history.state as Record<string, unknown> | null;
  const index = state?.[SVELTEKIT_HISTORY_INDEX_KEY];
  return typeof index === "number" ? index : null;
}

function hasElementForHash(hash: string): boolean {
  if (hash.length <= 1) return false;
  const id = decodeURIComponent(hash.slice(1));
  return id.length > 0 && document.getElementById(id) !== null;
}

// Wait for the incoming page: `tick()` resolves once the framework has flushed the new DOM into
// <main>, and the `requestAnimationFrame` after it yields until the browser has laid that DOM out,
// which measurement showed is the first point scrollHeight reflects the new page. The rAF callback
// runs before the frame paints, so the corrected offset lands without a visible flash.
function afterLayout(run: () => void): void {
  void tick().then(() => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else run();
  });
}

/**
 * Register the canvas scroll restoration. Call once during the shell's initialization, passing a
 * getter for the canvas element — `beforeNavigate`/`afterNavigate` must be registered during
 * component init, and the getter defers reading the element until a navigation actually fires, by
 * which point `bind:this` has populated it. The registration is torn down when the shell unmounts
 * and re-established when it mounts again (an HMR swap, for instance), so each live shell owns
 * exactly one active pair of hooks.
 */
export function installCanvasScrollRestoration(
  getCanvas: () => ScrollableCanvas | null | undefined,
): void {
  registerCanvasScrollRestoration({
    onBeforeNavigate: (callback) => beforeNavigate(callback),
    onAfterNavigate: (callback) =>
      afterNavigate((navigation) => callback({ type: navigation.type, to: navigation.to })),
    getCanvas,
    currentHistoryIndex,
    hasResolvedHashTarget: hasElementForHash,
    afterLayout,
  });
}
