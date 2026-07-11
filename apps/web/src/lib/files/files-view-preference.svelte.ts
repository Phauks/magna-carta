/*
 * The file surface's reactive preferences — the active view and the open regions, on the shared
 * persisted-preference primitive (which owns the storage guard, normalize-on-read, and the cross-tab
 * follower registered here once at module scope). The Files host injects both into the view shell.
 */
import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
import type { RegionVisibility } from "$lib/view-shell/view-shell-types.ts";
import { filesRegionsCodec, filesViewCodec, type FilesView } from "./files-view-preference.ts";

export const filesViewPreference = createPersistedPreference<FilesView>(filesViewCodec);
export const filesRegionsPreference =
  createPersistedPreference<RegionVisibility>(filesRegionsCodec);

filesViewPreference.followAcrossTabs();
filesRegionsPreference.followAcrossTabs();
