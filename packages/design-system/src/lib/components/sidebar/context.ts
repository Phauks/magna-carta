/*
 * Sidebar context — the collapsed (icon-rail) state, shared from Sidebar.Root down to the parts that
 * react to it (the trigger flips it; the menu button shows a rail tooltip when collapsed). Root owns
 * the backing `collapsed` rune and exposes it through getters so reads stay reactive.
 */
import { getContext, setContext } from "svelte";

const SIDEBAR_KEY = Symbol("mc-sidebar");

export interface SidebarContext {
  /** True when the sidebar is the narrow icon rail. */
  readonly collapsed: boolean;
  /**
   * True while a collapsed rail is floating open on hover (the overlay peek). The rail is still
   * collapsed — parts that surface labels in the rail (tooltips) suppress them during the peek,
   * since the labels are visible in the floated panel.
   */
  readonly peeking: boolean;
  toggle(): void;
  setCollapsed(value: boolean): void;
}

export function setSidebarContext(context: SidebarContext): SidebarContext {
  return setContext(SIDEBAR_KEY, context);
}

export function getSidebarContext(): SidebarContext {
  const context = getContext<SidebarContext | undefined>(SIDEBAR_KEY);
  if (!context) throw new Error("Sidebar parts must be used within <Sidebar.Root>.");
  return context;
}
