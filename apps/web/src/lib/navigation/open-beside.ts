/*
 * The one gate through which anything opens BESIDE the reader's work instead of in its place.
 *
 * A link in this product navigates in place: that is what a link is, and a reader who wants a
 * second view holds a modifier. Opening a new tab is the exception, and an exception that each
 * screen decides for itself is how a product ends up with fifteen `target="_blank"`s in three
 * spellings and no rule anybody can state. So the exception is modulated here: a caller names WHY
 * the destination cannot open in place, from a closed set, and a source scan refuses any `_blank`
 * that did not come through this module. Adding a reason is a reviewed change to this file, never
 * a call site's improvisation.
 *
 * The owner's ruling of 2026-09-02: opening a new tab is unusual; where it happens it follows one
 * repeatable, useful process rather than a screen's own judgement.
 */

/**
 * Why a destination opens beside the reader rather than in place. Each is a fact about the
 * destination, not a preference of the screen offering it.
 *
 * - `external`: the destination is not this application — another site, the documentation, the
 *   service status page, the terms. Navigating in place would drop the reader out of the product
 *   they were working in.
 * - `file`: the destination is bytes the browser handles — a signed download. Navigating in place
 *   would replace the application with a file.
 * - `session`: the destination is a separate working session with a life of its own — the document
 *   editor — that the reader keeps open beside the list they launched it from.
 * - `unsaved-work`: the destination is a record opened from a surface that holds a draft, where
 *   navigating in place would discard what the reader has begun.
 * - `live-meeting`: the destination is opened from inside a meeting room, where navigating in place
 *   would hang up the reader's call.
 * - `requested`: the reader chose an explicit "Open in new tab" command. The new tab is what they
 *   asked for, so opening in place would ignore the command they picked.
 */
export type OpenBesideReason =
  | "external"
  | "file"
  | "session"
  | "unsaved-work"
  | "live-meeting"
  | "requested";

export const OPEN_BESIDE_REASONS: readonly OpenBesideReason[] = [
  "external",
  "file",
  "session",
  "unsaved-work",
  "live-meeting",
  "requested",
];

/**
 * The attributes an anchor (or a `Button` with an `href`) carries to open beside the reader. The
 * `rel` is the isolation every such opening gets: the new page can neither reach back into this
 * one nor learn where it came from.
 */
export function opensBeside(reason: OpenBesideReason): {
  readonly target: "_blank";
  readonly rel: "noopener noreferrer";
} {
  // The reason is not rendered; it is the record, read by whoever reviews the call site.
  void reason;
  return { target: "_blank", rel: "noopener noreferrer" };
}

/**
 * Opens a destination beside the reader from code — a menu item that cannot render as an anchor,
 * a download that starts after a request answered. The same isolation as `opensBeside`.
 */
export function openBeside(href: string, reason: OpenBesideReason): void {
  void reason;
  globalThis.open(href, "_blank", "noopener,noreferrer");
}

/**
 * Reserves a blank tab beside the reader, inside a press, for a destination whose address a write
 * has not answered yet (a meeting started or a room opened: the browser lets a page open a tab only
 * while a press is in progress). It is NOT isolated, because this page has to point the tab once the
 * address is known; that is safe only because the destination is this application's own. Answers
 * null where the browser blocked the tab.
 */
export function reserveBeside(reason: OpenBesideReason): Window | null {
  void reason;
  return globalThis.open("about:blank", "_blank");
}
