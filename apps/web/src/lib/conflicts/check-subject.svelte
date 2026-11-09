<script lang="ts">
  /*
   * The New Check panel's LEFT pane: who the check is about.
   *
   * PARTIES AND NOTHING ELSE (owner's rulings, 2026-11-09). The panel used to ask which matter to
   * file the check on and then read the whole search back in sentences. Both are gone: a check is
   * a search for the parties, the matter it belongs to is chosen from the report once somebody
   * knows it, and what the check searches is the right pane's options, not a paragraph about them.
   *
   * Opened from a matter's own section the check is already that matter's, so the pane states the
   * matter it will be filed on. That is a fact about the surface, not a question.
   */
  import Label from "@magna-carta/design-system/label";
  import DirectoryEntityPicker from "$lib/directory/directory-entity-picker.svelte";
  import { directoryPickerSearch } from "$lib/directory/directory-picker-source.ts";
  import type { CheckDraft } from "./check-draft.svelte.ts";

  let {
    draft,
    matterLabel = null,
    busy = false,
  }: {
    draft: CheckDraft;
    /** How the surface's own matter reads, where the panel was opened from one. */
    matterLabel?: string | null;
    /** True while the panel's commit is in flight, so every field holds still. */
    busy?: boolean;
  } = $props();

  const fieldPrefix = $props.id();
  const partySearch = directoryPickerSearch(fetch);
</script>

<div class="flex flex-col gap-16">
  <div class="flex flex-col gap-8">
    <Label for="{fieldPrefix}-parties">Parties</Label>
    <!-- A check takes directory entities, never typed names: the one picker, in multiple mode. -->
    <DirectoryEntityPicker
      search={partySearch}
      multiple
      bind:values={draft.parties}
      label="Party"
      inputId="{fieldPrefix}-parties"
      disabled={busy}
      disabledReason={busy ? "The check is running." : undefined}
    />
  </div>

  {#if matterLabel !== null}
    <div class="flex flex-col gap-8">
      <Label>Matter</Label>
      <p class="text-sm">{matterLabel}</p>
    </div>
  {/if}
</div>
