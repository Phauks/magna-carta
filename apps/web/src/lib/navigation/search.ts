/*
 * The one home for the search-affordance label. The passive top-bar trigger (the resting
 * "Search…" chip) and the active command-palette input must read identically — the palette opens
 * ON the trigger, so a drift between the two would show as the text changing under the pointer.
 * One constant, both surfaces (app-shell.svelte's TopBar.Search and command-palette.svelte's
 * Command.Input); edit it here and both move together.
 */
export const SEARCH_PLACEHOLDER = "Search…";
