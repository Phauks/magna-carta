/*
 * The app shell's work-canvas scroll policy — the pure decision and the framework-free wiring
 * core, so both unit-test without a DOM.
 *
 * In this shell the chrome (top bar and sidebar) is fixed and only <main> scrolls, so the window
 * never moves. SvelteKit's built-in scroll restoration scrolls the WINDOW, which is a no-op here;
 * nothing touches the canvas, so its scrollTop carries over from the page you just left. This
 * module decides — from a navigation descriptor alone — whether the canvas should reset to the
 * top, restore a saved offset, or be left alone, and wires that decision into a navigation
 * lifecycle through injected dependencies. The concrete dependencies (SvelteKit's
 * before/afterNavigate, the DOM, the tick-then-frame layout wait) live in
 * canvas-scroll-restoration.ts.
 */

/** What the canvas should do after a navigation completes. */
export type CanvasScrollAction =
  | { readonly kind: "reset" }
  | { readonly kind: "restore"; readonly top: number }
  | { readonly kind: "leaveAlone" };

/** The navigation facts the decision needs, distilled from SvelteKit's `AfterNavigate`. */
export interface CanvasNavigationDescriptor {
  /** SvelteKit's navigation type for this `afterNavigate` call. */
  readonly type: "enter" | "form" | "link" | "goto" | "popstate";
  /**
   * The destination URL carries a hash AND a matching element exists in the freshly rendered
   * page. When true the in-page anchor owns the position and the canvas must not reset over it.
   */
  readonly hasResolvedHashTarget: boolean;
  /**
   * The canvas offset saved for the history entry being restored (back/forward), or null when no
   * offset is known for it — first visit under that entry, or it was never recorded.
   */
  readonly restoredOffset: number | null;
}

/**
 * Decide what the work canvas does after a navigation.
 *
 * - A resolved hash target wins over everything: leave the position alone.
 * - Back/forward restores the reader to where they were on that entry; with no saved offset it
 *   falls back to the top rather than stranding them at the previous route's offset.
 * - Initial hydration is left alone — the first paint is already at the top (or at a hash handled
 *   above) and nothing has carried over yet.
 * - Every forward navigation — a link click, a `goto`, a GET form — starts the new page at its top.
 */
export function decideCanvasScroll(descriptor: CanvasNavigationDescriptor): CanvasScrollAction {
  if (descriptor.hasResolvedHashTarget) return { kind: "leaveAlone" };

  if (descriptor.type === "popstate") {
    return descriptor.restoredOffset === null
      ? { kind: "reset" }
      : { kind: "restore", top: descriptor.restoredOffset };
  }

  if (descriptor.type === "enter") return { kind: "leaveAlone" };

  return { kind: "reset" };
}

/**
 * The offset a decided action wants the canvas scrolled to, or null when the canvas is left alone.
 * A reset always targets the top (0), which survives any clamp; a restore targets its saved offset.
 */
export function canvasScrollTarget(action: CanvasScrollAction): number | null {
  if (action.kind === "reset") return 0;
  if (action.kind === "restore") return action.top;
  return null;
}

/**
 * Per-history-entry canvas offsets. SvelteKit's own window-scroll restoration cannot reach an
 * inner scroll container, so the shell records `main.scrollTop` here keyed by SvelteKit's history
 * index and reads it back on a back/forward navigation. `peek` never deletes: a reader can walk
 * back and forth across the same entry repeatedly, and each departure re-saves the latest offset.
 */
export class CanvasScrollMemory {
  readonly #offsets = new Map<number, number>();

  save(historyIndex: number, top: number): void {
    this.#offsets.set(historyIndex, top);
  }

  peek(historyIndex: number): number | null {
    return this.#offsets.get(historyIndex) ?? null;
  }
}

/** The single writable property the wiring needs from the scroll container. */
export interface ScrollableCanvas {
  scrollTop: number;
}

/** The subset of SvelteKit's `AfterNavigate` the wiring reads. */
export interface CanvasNavigation {
  readonly type: "enter" | "form" | "link" | "goto" | "popstate";
  readonly to: { readonly url: { readonly hash: string } } | null;
}

/** Everything the wiring core needs from its host, injected so the ordering is unit-testable. */
export interface CanvasScrollRestorationDependencies {
  /** Register a callback for just before a navigation leaves the current entry. */
  readonly onBeforeNavigate: (callback: () => void) => void;
  /** Register a callback for just after a navigation completes. */
  readonly onAfterNavigate: (callback: (navigation: CanvasNavigation) => void) => void;
  /** The live scroll container, or null/undefined before it has mounted. */
  readonly getCanvas: () => ScrollableCanvas | null | undefined;
  /** SvelteKit's index for the current history entry, or null if it cannot be read. */
  readonly currentHistoryIndex: () => number | null;
  /** Whether the destination hash resolves to a real element in the freshly rendered page. */
  readonly hasResolvedHashTarget: (hash: string) => boolean;
  /**
   * Run a callback once the INCOMING page has laid out. `afterNavigate` fires while <main> still
   * holds the outgoing page's DOM, so its scrollHeight is the old page's; a restore offset applied
   * then is clamped against the wrong height. The concrete implementation waits a tick (for the
   * framework to swap the DOM) then a frame (for the browser to lay it out).
   */
  readonly afterLayout: (callback: () => void) => void;
}

/**
 * Wire the canvas scroll policy into a navigation lifecycle.
 *
 * Leaving a page banks its current canvas offset per history entry. Arriving on one decides the
 * action, then applies the target offset TWICE: once immediately, so a reset (0, which no clamp
 * can move) lands before the incoming page paints and never flashes the carried-over position;
 * and again after the incoming page has laid out, which is the point at which a restore offset is
 * measured against the correct scrollHeight. When the destination is genuinely shorter than the
 * saved offset the browser clamps the post-layout assignment — a legitimate clamp we set once and
 * do not re-force, so there is nothing to fight. The assignment is instant; nothing here animates
 * scrollTop.
 */
export function registerCanvasScrollRestoration(
  dependencies: CanvasScrollRestorationDependencies,
): void {
  const memory = new CanvasScrollMemory();

  // The history index of the entry we are CURRENTLY on. This MUST be tracked across navigations
  // rather than read inside `beforeNavigate` — do not "simplify" it back to a currentHistoryIndex()
  // call there. By the time SvelteKit invokes a `beforeNavigate` callback it has already advanced
  // history.state to the DESTINATION entry, so reading the index there banks the outgoing page's
  // offset under the INCOMING entry's key. The reader then never gets it back on Back (the outgoing
  // key holds nothing, so the decision falls through to a reset), and the stray offset resurfaces —
  // clamped — on the wrong page when that incoming entry is later revisited. We capture the entry at
  // install and refresh it in `afterNavigate`, where the index legitimately is the entry just
  // arrived on.
  let currentEntryIndex = dependencies.currentHistoryIndex();

  dependencies.onBeforeNavigate(() => {
    const canvas = dependencies.getCanvas();
    if (canvas == null || currentEntryIndex === null) return;
    memory.save(currentEntryIndex, canvas.scrollTop);
  });

  dependencies.onAfterNavigate((navigation) => {
    const arrivedIndex = dependencies.currentHistoryIndex();
    const action = decideCanvasScroll({
      type: navigation.type,
      hasResolvedHashTarget: dependencies.hasResolvedHashTarget(navigation.to?.url.hash ?? ""),
      restoredOffset: arrivedIndex === null ? null : memory.peek(arrivedIndex),
    });
    currentEntryIndex = arrivedIndex;

    const target = canvasScrollTarget(action);
    if (target === null) return;

    const apply = (): void => {
      const canvas = dependencies.getCanvas();
      if (canvas != null) canvas.scrollTop = target;
    };
    apply();
    dependencies.afterLayout(apply);
  });
}
