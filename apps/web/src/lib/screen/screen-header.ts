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
import ClipboardPenLine from "@lucide/svelte/icons/clipboard-pen-line";
import FolderOpen from "@lucide/svelte/icons/folder-open";
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

/**
 * A matter's Files section — where a document's editor was opened from. Spelled out rather than
 * a destination id because the sidebar carries the matters list, not any one matter: the way back
 * from a document leads to the matter it belongs to, opened on its files with the document
 * revealed, and that address is the matter's own. The label is the matter's title, so the reader
 * learns which matter the link lands on rather than only that it lands on some files.
 */
/**
 * A public intake form's builder — where its submissions screen was opened from.
 *
 * Spelled out rather than named by destination id for the same reason the matter's files are: the
 * way back is to ONE form, and the reader learns which one from its own name rather than from the
 * word "Forms".
 */
export function intakeFormBack(formId: string, formName: string): BackDestination {
  return {
    href: `/forms/${encodeURIComponent(formId)}`,
    label: formName,
    icon: ClipboardPenLine,
  };
}

export function matterFilesBack(
  matterId: string,
  matterTitle: string,
  fileId?: string,
): BackDestination {
  const entry = fileId === undefined ? "" : `?entry=${encodeURIComponent(fileId)}`;
  return {
    href: `/matters/${encodeURIComponent(matterId)}/files${entry}`,
    label: matterTitle,
    icon: FolderOpen,
  };
}
