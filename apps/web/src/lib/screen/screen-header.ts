/*
 * Where a screen's way back leads, and how a screen says it.
 *
 * The ordinary answer is a DESTINATION ID — one of the sidebar's own destinations. Naming the
 * destination rather than a URL is what keeps the way back honest: the href, the user-facing label
 * and the glyph all come from the one registry (navigation/destinations.ts), so a back link cannot
 * point at a screen that does not exist, cannot call it something the sidebar calls something else,
 * and cannot go stale when a destination's path changes. The id is a literal union, so a typo is a
 * type error.
 *
 * The escape hatch is an explicit descriptor, for the few screens that sit under something the
 * sidebar does not carry — the developer console, which is dev-only and deliberately outside the
 * app shell. It is deliberately more work to write than an id.
 */
import type { Component } from "svelte";
import Terminal from "@lucide/svelte/icons/terminal";
import { destinationById, type DestinationId } from "$lib/navigation/destinations.ts";

/** A screen the way back leads to, spelled out — for destinations outside the sidebar registry. */
export interface BackDestination {
  readonly href: string;
  /** The destination's name, as the reader knows it. Spoken as "Back to <label>". */
  readonly label: string;
  /** The destination's glyph — the screen in miniature, shown beside its name. */
  readonly icon?: Component;
}

/** What a screen passes as its `back`: a sidebar destination's id, or a spelled-out screen. */
export type BackTarget = DestinationId | BackDestination;

/**
 * The destination a `back` names. An id resolves through the registry; a descriptor is already
 * resolved. Returns null only for an id the registry does not hold, which the id union makes
 * unreachable from typed code.
 */
export function resolveBackDestination(back: BackTarget): BackDestination | null {
  if (typeof back !== "string") return back;
  const destination = destinationById(back);
  if (destination === null) return null;
  return { href: destination.href, label: destination.label, icon: destination.icon };
}

/** The developer console — a real screen with sub-screens, deliberately outside the sidebar. */
export const DEVELOPER_CONSOLE_BACK: BackDestination = {
  href: "/developer-console",
  label: "Developer console",
  icon: Terminal,
};
