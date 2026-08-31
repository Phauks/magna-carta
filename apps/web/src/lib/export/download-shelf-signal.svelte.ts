/*
 * The one signal between "something was just downloaded" and the top-bar tray.
 *
 * The export menu and the tray never meet: the menu is rendered by whichever screen is exporting,
 * the tray is seated once in the shell. Without this the tray would only learn about a new item on
 * the next page load, which is exactly the moment a member is looking at the top bar for
 * confirmation that their download was kept.
 *
 * A counter rather than a payload: the tray re-reads the shelf from the server, so what it needs is
 * "something changed", not a copy of what changed that could disagree with the record.
 */
let revision = $state(0);

/** Bumped whenever an export lands on the shelf, or an item is taken or removed. */
export function shelfRevision(): number {
  return revision;
}

export function markShelfChanged(): void {
  revision += 1;
}
