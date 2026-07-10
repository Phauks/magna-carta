/*
 * The Tools page's view choice — a card grid ("tiles") or a dense list ("list"). This pure
 * module holds the shape, the default, the storage key, and the read-time validation; the rune
 * store beside it (tools-view-preference.svelte.ts) owns the reactive state and localStorage.
 * The split keeps this logic unit-testable under the plugin-less web test config.
 */
export type ToolsView = "tiles" | "list";

export const DEFAULT_VIEW: ToolsView = "tiles";

export const TOOLS_VIEW_STORAGE_KEY = "mc-tools-view";

/** Normalize a stored value: only the two known views survive; everything else is the default. */
export function parseToolsView(raw: string | null): ToolsView {
  return raw === "tiles" || raw === "list" ? raw : DEFAULT_VIEW;
}
