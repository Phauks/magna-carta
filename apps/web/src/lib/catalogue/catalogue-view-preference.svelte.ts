/*
 * A catalogue's remembered view, per browser. One factory rather than a module per catalogue: the
 * choice is the same choice on every catalogue and only the storage key differs, so the key is the
 * argument and everything else is decided once.
 *
 * The persisted-preference primitive owns the storage read and write, the SSR guard, and
 * normalize-on-read (through the string-union codec, which folds a stale or hand-edited value back
 * to the default). The cross-tab follower is registered here, so a catalogue that calls this at
 * module scope gets one listener for the life of the tab.
 */
import {
  createPersistedPreference,
  type PersistedPreference,
} from "$lib/preferences/persisted-preference.svelte.ts";
import { stringUnionPreference } from "$lib/preferences/persisted-preference.ts";
import { CATALOGUE_VIEWS, DEFAULT_CATALOGUE_VIEW, type CatalogueView } from "./catalogue-view.ts";

/** The remembered view for one catalogue, under its own storage key. */
export function createCatalogueViewPreference(
  storageKey: string,
): PersistedPreference<CatalogueView> {
  const preference = createPersistedPreference(
    stringUnionPreference(storageKey, CATALOGUE_VIEWS, DEFAULT_CATALOGUE_VIEW),
  );
  preference.followAcrossTabs();
  return preference;
}
