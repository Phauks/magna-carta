/*
 * The reactive Tools view preference — a per-browser choice (tiles or list), on the shared
 * persisted-preference primitive. The primitive owns the localStorage read/write, the SSR guard,
 * normalize-on-read (through parseToolsView), and the cross-tab follower registered here once at
 * module scope. The Tools page injects this store into the multi-view shell as its active-view
 * preference.
 */
import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
import { parseToolsView, TOOLS_VIEW_STORAGE_KEY, type ToolsView } from "./tools-view-preference.ts";

export const toolsViewPreference = createPersistedPreference<ToolsView>({
  storageKey: TOOLS_VIEW_STORAGE_KEY,
  decode: parseToolsView,
  encode: (view) => view,
});

toolsViewPreference.followAcrossTabs();
