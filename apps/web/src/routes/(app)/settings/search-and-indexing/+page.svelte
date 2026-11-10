<script lang="ts">
  /*
   * Settings · Search and Indexing — what the firm's searches read, under Data & Platform. One
   * setting today: whether the words inside the firm's files are indexed.
   *
   * LIVE, over GET/PATCH /api/v1/firm/search-settings, through the standard page
   * (settings-page.svelte) over the shared server-backed draft. The ingest path reads the same
   * setting before it hands a file to the index and a matter's search reads it before it asks the
   * index anything, so a save here reaches the next file filed and the next search run; the edit
   * right is `firm:manageSearchSettings`, read from the session.
   *
   * ONE THING BENEATH THE ROW, READ AND NEVER WRITTEN HERE. A switch alone would let a firm believe
   * something untrue, so the page states what the read carries: while this deployment has no search
   * service, that nothing inside a file can be searched until it does, whatever the switch says;
   * and once indexing is on, that the files already here are read over days.
   *
   * BENEATH THE SETTING, WHAT IT COMES TO (search-status.svelte): the standing of each index and
   * the table of indexed places, counted by the server when the page opens. Shown to a member who
   * holds the edit right, because the count is behind the same permission as the setting.
   *
   * HISTORY IS WITHHELD, for the reason the calendar page withholds it: the record of a change is
   * the audit row the server writes, and a per-browser ledger would be one browser's recollection
   * of a firm-wide fact.
   */
  import SearchStatus from "$lib/settings/components/search-status.svelte";
  import SettingsPage from "$lib/settings/components/settings-page.svelte";
  import SettingsPlateNote from "$lib/settings/components/settings-plate-note.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import { MANAGE_SEARCH_SETTINGS_PERMISSION } from "$lib/settings/search-settings-api.ts";
  import {
    createSearchSettingsDraft,
    FILE_CONTENTS_INDEXED_DEFINITION,
    SEARCH_AND_INDEXING_DEFINITIONS,
    SEARCH_AND_INDEXING_SECTION_ID,
  } from "$lib/settings/search-settings-draft.svelte.ts";

  const draft = createSearchSettingsDraft(fetch);

  // Read-only until the session says otherwise: a control that appears and then vanishes when the
  // permission turns out to be missing reads as a broken page.
  const canEdit = $derived(sessionPermissions.holds(MANAGE_SEARCH_SETTINGS_PERMISSION));

  $effect(() => {
    void sessionPermissions.load(fetch);
  });
</script>

<svelte:head>
  <title>Search and Indexing · Settings · Magna Carta</title>
</svelte:head>

{#snippet afterRow(definition: SettingDefinition)}
  {#if draft.committed !== null && definition.id === FILE_CONTENTS_INDEXED_DEFINITION.id}
    {#if !draft.committed.searchServiceConnected}
      <SettingsPlateNote>
        The platform's search service is not connected yet, so nothing inside a file can be
        searched until it is, whatever this switch says. Files and folders are still found by
        name.
      </SettingsPlateNote>
    {:else if draft.committed.fileContentsIndexed}
      <SettingsPlateNote>
        A file added from now on is read as it arrives. The files the firm already holds are read
        in the background over the following days, the oldest first.
      </SettingsPlateNote>
    {/if}
  {/if}
{/snippet}

{#snippet after()}
  {#if canEdit}
    <SearchStatus />
  {/if}
{/snippet}

<SettingsPage
  sectionId={SEARCH_AND_INDEXING_SECTION_ID}
  title="Search and Indexing"
  meta="What the firm's searches read. Notes, time, tasks, calls and the other records are always searchable; the words inside files are searched once the firm turns that on."
  {draft}
  definitions={SEARCH_AND_INDEXING_DEFINITIONS}
  {canEdit}
  readLabel="Reading the firm's search settings"
  readFailureTitle="The Search Settings Could Not Be Read"
  readFailureFallback="The firm's search settings were not read."
  saveFailureFallback="The search settings are unchanged. What you chose is still staged."
  saveFailureWhenSilent="Nothing answered, so the search settings are unchanged. What you chose is still staged."
  {afterRow}
  {after}
/>
