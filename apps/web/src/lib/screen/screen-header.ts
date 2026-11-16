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
import FolderOpen from "@lucide/svelte/icons/folder-open";
import Microscope from "@lucide/svelte/icons/microscope";
import Package from "@lucide/svelte/icons/package";
import Landmark from "@lucide/svelte/icons/landmark";
import Receipt from "@lucide/svelte/icons/receipt";
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

/**
 * The File Workbench — a real screen with a sub-screen (a password-recovery job), spelled out
 * because the workbench is a TOOL and tools are not in the destination registry: what a tool is has
 * one home, the catalog (@magna-carta/tools), and the rail projects its rows from there. Spelling
 * this one out is cheaper than teaching the back-link vocabulary to read a second registry for the
 * single screen that sits under a tool. A test pins it to the manifest, so the two cannot drift.
 */
export const FILE_WORKBENCH_BACK: BackDestination = {
  href: "/file-workbench",
  label: "File Workbench",
  icon: Microscope,
};

/**
 * Shipping & Postage — a tool with a sub-screen (drafting a shipment), spelled out for exactly the
 * reason the workbench above is: a tool's identity lives in the catalog (@magna-carta/tools) and the
 * rail projects its row from there, so the destination registry does not hold one. A test pins this
 * to the manifest, so the two cannot drift.
 */
export const SHIPPING_BACK: BackDestination = {
  href: "/shipping",
  label: "Shipping & Postage",
  icon: Package,
};

/**
 * The trust register and one account's Checks screen, the two screens the check printing screens
 * sit under. Both name an account in the address, which the screen adds with `withAccount`: the
 * path is the destination, the account is which one of it.
 */
export const TRUST_BACK: BackDestination = {
  href: "/trust",
  label: "Trust",
  icon: Landmark,
};

export const TRUST_CHECKS_BACK: BackDestination = {
  href: "/trust/checks",
  label: "Checks",
  icon: Receipt,
};

/** A spelled-out way back, opened on one trust account. */
export function withAccount(back: BackDestination, trustAccountId: string): BackDestination {
  return { ...back, href: `${back.href}?account=${encodeURIComponent(trustAccountId)}` };
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
