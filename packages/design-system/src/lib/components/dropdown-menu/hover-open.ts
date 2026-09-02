/*
 * Hover activation for DropdownMenu — a pointer resting on a trigger opens its menu, and the menu
 * then follows the pointer: it stays while the pointer is over the trigger, the panel, or a submenu
 * opened from the panel, and closes a beat after the pointer has left all of them. Owner's
 * direction, 2026-09-02: a menu a member has to click open costs a press to learn what is behind a
 * word like Money, and the matter's section strip is read by pointing at it.
 *
 * WHAT IT DOES NOT CHANGE. Click, keyboard (Enter, Space, ArrowDown), touch, and assistive
 * technology open the menu exactly as before — Bits owns those paths — and a menu opened that way
 * is not a hover-opened one, so leaving it with the pointer does not close it. Hover is added to
 * the deliberate gesture, never put in its place, which is what keeps the menu reachable from a
 * keyboard and from a screen where nothing hovers. Only a mouse pointer counts: a touch tap fires
 * pointerenter too, and treating it as a hover would open the menu and then toggle it shut on the
 * press that follows.
 *
 * FOCUS STAYS WHERE IT WAS. Bits moves focus into a menu when it opens and back to the trigger when
 * it closes — right for a press, wrong for a pointer that merely rested on a word while the member
 * was typing in a search field. A hover-opened menu suppresses both moves unless focus has genuinely
 * entered the panel (a key press, or an item the pointer highlighted), and then Bits returns it to
 * the trigger as it always did.
 *
 * ONE HOVER MENU AT A TIME. Two triggers side by side (Money and Record on the matter strip) would
 * otherwise overlap for the length of the close linger as the pointer slides from one to the next;
 * opening by hover closes whichever other menu hover had opened, at once.
 *
 * A PRESS ON AN OPEN TRIGGER KEEPS IT OPEN. Bits toggles the menu on pointerdown, which would shut
 * a menu the pointer had already opened the moment the member reached for it. Cancelling that
 * pointerdown skips Bits' handler (svelte-toolbelt composes handlers and stops at a cancelled
 * event), so the press lands on a menu that is simply still there.
 *
 * The controller is shared from Root to Trigger, Content, and SubContent through Svelte context, so
 * every part reports the pointer to the same place and the DOM — the panel is portaled to the body,
 * far from its trigger — is never consulted for containment. It is plain state, not runes: nothing
 * renders from it, every read happens inside an event handler, and a timer is the whole mechanism.
 */
import { getContext, setContext } from "svelte";

const HOVER_OPEN_KEY = Symbol("mc-dropdown-menu-hover-open");

/**
 * The wait before a pointer resting on a trigger opens its menu — long enough that a pointer crossing
 * the strip on its way somewhere else opens nothing, short enough that the menu feels as if it were
 * already there.
 */
export const HOVER_OPEN_DELAY_MS = 120;

/**
 * The linger after the pointer leaves the trigger or the panel before a hover-opened menu closes —
 * long enough to cross the gap between the two (the Content's sideOffset) and to slip from a panel
 * into its submenu, short enough that a menu does not hang over the page the member has moved on to.
 */
export const HOVER_CLOSE_DELAY_MS = 250;

/** What a controller needs from the menu it drives; each answer is read at the moment of the gesture. */
export interface HoverOpenHost {
  /** Whether hover activation is on for this menu. */
  enabled: () => boolean;
  isOpen: () => boolean;
  setOpen: (open: boolean) => void;
}

/** The one menu hover currently holds open, so a second hover-open can close it. */
const activeHoverMenu: { current: HoverOpenController | null } = { current: null };

function isHoverPointer(event: PointerEvent): boolean {
  return event.pointerType === "mouse";
}

export class HoverOpenController {
  readonly #host: HoverOpenHost;
  /** True from a hover-open until the menu closes by any route. */
  #openedByHover = false;
  #openTimer: ReturnType<typeof setTimeout> | undefined;
  #closeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(host: HoverOpenHost) {
    this.#host = host;
  }

  /** True while the menu is open because the pointer opened it. */
  get openedByHover(): boolean {
    return this.#openedByHover;
  }

  /** The pointer arrived over the trigger, the panel, or a submenu panel. */
  pointerEnter(event: PointerEvent): void {
    if (!isHoverPointer(event)) return;
    // Re-entering any part of the menu means "stay open" — a pending close is cancelled first.
    clearTimeout(this.#closeTimer);
    this.#closeTimer = undefined;
    if (!this.#host.enabled() || this.#host.isOpen()) return;
    clearTimeout(this.#openTimer);
    this.#openTimer = setTimeout(() => this.#openByHover(), HOVER_OPEN_DELAY_MS);
  }

  /** The pointer left the trigger, the panel, or a submenu panel. */
  pointerLeave(event: PointerEvent): void {
    if (!isHoverPointer(event)) return;
    // A pointer that left before the wait was up never meant to open anything.
    clearTimeout(this.#openTimer);
    this.#openTimer = undefined;
    if (!this.#openedByHover) return;
    clearTimeout(this.#closeTimer);
    this.#closeTimer = setTimeout(() => this.#closeByHover(), HOVER_CLOSE_DELAY_MS);
  }

  /** A press on the trigger while hover holds the menu open: the menu stays, rather than toggling shut. */
  triggerPointerDown(event: PointerEvent): void {
    if (!this.#openedByHover || !this.#host.isOpen()) return;
    if (!isHoverPointer(event) || event.button !== 0) return;
    event.preventDefault();
  }

  /** Bits is about to move focus into the panel on open; a hover-opened menu leaves focus where it was. */
  openAutoFocus(event: Event): void {
    if (this.#openedByHover) event.preventDefault();
  }

  /**
   * Bits is about to return focus to the trigger on close. A hover-opened menu that focus never
   * entered leaves it where it was; once focus is inside the panel, the return is the right move.
   */
  closeAutoFocus(event: Event, panel: HTMLElement | null): void {
    if (!this.#openedByHover) return;
    const active = panel?.ownerDocument.activeElement ?? null;
    if (panel !== null && active !== null && panel.contains(active)) return;
    event.preventDefault();
  }

  /**
   * Root reports every change of `open`, whichever route made it. A deliberate open supersedes a
   * pending hover intent, and a close by any route — a selection, Escape, a press outside — ends the
   * hover episode so the next pointer-leave has nothing to close.
   */
  openChanged(open: boolean): void {
    clearTimeout(this.#openTimer);
    this.#openTimer = undefined;
    if (!open) this.#endEpisode();
  }

  /** Close a hover-opened menu now, with no linger. No effect on a menu opened deliberately. */
  closeNow(): void {
    if (!this.#openedByHover) return;
    this.#endEpisode();
    this.#host.setOpen(false);
  }

  /** The menu is going away; nothing pending may fire after it. */
  destroy(): void {
    this.#endEpisode();
  }

  #openByHover(): void {
    this.#openTimer = undefined;
    if (!this.#host.enabled() || this.#host.isOpen()) return;
    if (activeHoverMenu.current !== null && activeHoverMenu.current !== this) {
      activeHoverMenu.current.closeNow();
    }
    activeHoverMenu.current = this;
    // Marked before the open so the panel's open-auto-focus sees a hover-opened menu on mount.
    this.#openedByHover = true;
    this.#host.setOpen(true);
  }

  #closeByHover(): void {
    this.#closeTimer = undefined;
    this.closeNow();
  }

  #endEpisode(): void {
    clearTimeout(this.#openTimer);
    clearTimeout(this.#closeTimer);
    this.#openTimer = undefined;
    this.#closeTimer = undefined;
    this.#openedByHover = false;
    if (activeHoverMenu.current === this) activeHoverMenu.current = null;
  }
}

export function setHoverOpenContext(controller: HoverOpenController): HoverOpenController {
  return setContext(HOVER_OPEN_KEY, controller);
}

export function getHoverOpenContext(): HoverOpenController {
  const controller = getContext<HoverOpenController | undefined>(HOVER_OPEN_KEY);
  if (!controller) throw new Error("DropdownMenu parts must be used within <DropdownMenu.Root>.");
  return controller;
}
