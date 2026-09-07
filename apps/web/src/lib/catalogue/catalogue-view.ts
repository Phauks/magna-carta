/*
 * How a catalogue is laid out — the two views every catalogue offers, and which one a member who
 * has never chosen gets.
 *
 * Both views show the same entries under the same headings and differ only in density: `tiles` is
 * a card grid, for a catalogue a reader is browsing to see what exists; `list` is a dense run of
 * rows, for one they already know and are walking. A catalogue registers both — a third view would
 * be a third answer to "what does a catalogue look like", which is what this whole area is for
 * avoiding.
 *
 * Kept free of runes so the vocabulary imports anywhere (a page, the preference factory, a test).
 */
export type CatalogueView = "tiles" | "list";

/** The views in the order the switch presents them. */
export const CATALOGUE_VIEWS: readonly CatalogueView[] = ["tiles", "list"];

/**
 * Tiles, unchosen. A catalogue is met before it is known: the first visit is browsing, and a card
 * carries the descriptive line at a size that reads as prose rather than as a column.
 */
export const DEFAULT_CATALOGUE_VIEW: CatalogueView = "tiles";
