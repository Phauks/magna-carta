/*
 * Which tab a record opens on.
 *
 * A record that carries files opens on them, so the file is in front of the reader the moment the
 * window appears rather than one click behind a tab strip they have to notice first. The window
 * already takes the tab to open on; what was missing was a single answer to "which tab is that",
 * agreed once here instead of decided again by every record type — because the moment two record
 * types spell the key differently, one of them silently stops opening on its files and nothing
 * fails.
 */

/**
 * The key the attachments tab is registered under, wherever a record window lists its tabs. Use it
 * for the tab's own `key` and for the window's opening tab, so the two cannot drift apart.
 */
export const ATTACHMENTS_TAB_KEY = "attachments";

/**
 * The tab a record should open on, given how many files it carries.
 *
 * It takes a COUNT rather than the attachments themselves because the count is what a listing knows
 * before anything is loaded: a row states how many files a record has, and opening that record from
 * the row must land on them without waiting to find out what they are.
 *
 * `otherwise` is what a record with no files opens on, and is usually left out — the window then
 * falls back to its first tab, which is the right answer when nothing is waiting.
 */
export function openingTabForAttachments(
  attachmentCount: number,
  otherwise?: string,
): string | undefined {
  return attachmentCount > 0 ? ATTACHMENTS_TAB_KEY : otherwise;
}
