/*
 * The firm's search settings as a settings draft — the one switch the Search and Indexing page
 * renders, and what its staged value means as a change to send. The staging, counting and saving
 * are the shared server-backed draft's ($lib/settings/server-backed-draft.svelte.ts); this module
 * is the field mapping and the words.
 *
 * THE ROW SAYS WHAT TURNING IT ON DOES: the text of every file the firm holds is copied into an
 * index. What the row cannot say from its own value — that this deployment has no search service
 * yet, or that the files already here are read over days and not at once — the page states beneath
 * it, from the read.
 */
import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";
import {
  ServerBackedSettingsDraft,
  type ServerBackedField,
} from "$lib/settings/server-backed-draft.svelte.ts";
import {
  readSearchSettings,
  updateSearchSettings,
  type SearchSettings,
  type SearchSettingsPatch,
} from "./search-settings-api.ts";

/** The settings section this draft belongs to (settings-sections.ts). */
export const SEARCH_AND_INDEXING_SECTION_ID = "search-and-indexing";

export const FILE_CONTENTS_INDEXED_DEFINITION: SettingDefinition = {
  id: "search.file-contents-indexed",
  sectionId: SEARCH_AND_INDEXING_SECTION_ID,
  plateLabel: "File Contents",
  label: "Search Inside Files",
  description:
    "Reads the words inside the firm's files and keeps an index of them in the firm's own storage, so a matter's search finds a file by what it says and not only by its name. A search still shows a file only to somebody who could already open it.",
  kind: "switch",
  defaultValue: false,
  sensitivity: "open",
  audited: true,
};

/** Every definition the page renders, in reading order. */
export const SEARCH_AND_INDEXING_DEFINITIONS: readonly SettingDefinition[] = [
  FILE_CONTENTS_INDEXED_DEFINITION,
];

const FIELDS: readonly ServerBackedField<SearchSettings, SearchSettingsPatch>[] = [
  {
    definition: FILE_CONTENTS_INDEXED_DEFINITION,
    valueOf: (settings) => settings.fileContentsIndexed,
    applyTo: (patch, value) =>
      typeof value === "boolean" ? { ...patch, fileContentsIndexed: value } : null,
  },
];

export function createSearchSettingsDraft(
  fetchImpl: typeof fetch,
): ServerBackedSettingsDraft<SearchSettings, SearchSettingsPatch> {
  return new ServerBackedSettingsDraft({
    sectionId: SEARCH_AND_INDEXING_SECTION_ID,
    fields: FIELDS,
    read: () => readSearchSettings(fetchImpl),
    write: (patch, idempotencyKey) => updateSearchSettings(fetchImpl, patch, idempotencyKey),
  });
}
