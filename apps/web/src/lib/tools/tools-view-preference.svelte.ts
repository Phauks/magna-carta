/*
 * The reactive Tools view preference — a per-browser choice, stored in localStorage and synced
 * across tabs by the storage event (the sidebar-preferences pattern). SSR/prerender-safe: module
 * init never assumes a browser. Reads and writes go through parseToolsView so a stale value
 * normalizes on read.
 */
import {
  DEFAULT_VIEW,
  TOOLS_VIEW_STORAGE_KEY,
  parseToolsView,
  type ToolsView,
} from "./tools-view-preference.ts";

function readStored(): ToolsView {
  if (typeof localStorage === "undefined") return DEFAULT_VIEW;
  try {
    return parseToolsView(localStorage.getItem(TOOLS_VIEW_STORAGE_KEY));
  } catch {
    return DEFAULT_VIEW;
  }
}

function persist(view: ToolsView): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(TOOLS_VIEW_STORAGE_KEY, view);
  } catch {
    // Storage unavailable; the live preference still works for the session.
  }
}

const state = $state<{ view: ToolsView }>({ view: readStored() });

// Follow the choice across same-origin tabs. `event.key === null` is storage.clear().
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== TOOLS_VIEW_STORAGE_KEY) return;
    state.view = readStored();
  });
}

/** Read reactively in markup. */
export function toolsView(): ToolsView {
  return state.view;
}

export function setToolsView(view: ToolsView): void {
  if (state.view === view) return;
  state.view = view;
  persist(view);
}
