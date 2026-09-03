/*
 * Which tab a record's parties are under.
 *
 * The same agreement the attachments tab makes, for the same reason: the moment two record types
 * spell the key differently, one of them silently stops opening on its people and nothing fails. The
 * key is decided once here and imported everywhere a record window lists its tabs.
 */

/**
 * The key the parties tab is registered under, wherever a record window lists its tabs. Use it for
 * the tab's own `key` and for the window's opening tab, so the two cannot drift apart.
 */
export const PARTIES_TAB_KEY = "parties";

/**
 * The tab a record should open on, given how many parties it carries.
 *
 * A count rather than the parties themselves, because the count is what a listing knows before
 * anything is loaded. `otherwise` is what a record with nobody on it opens on, and is usually left
 * out — the window then falls back to its first tab.
 */
export function openingTabForParties(partyCount: number, otherwise?: string): string | undefined {
  return partyCount > 0 ? PARTIES_TAB_KEY : otherwise;
}
