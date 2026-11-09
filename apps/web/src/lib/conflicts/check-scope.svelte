<script lang="ts">
  /*
   * The New Check panel's RIGHT pane: where the check searches, and how it compares names.
   *
   * TWO TABS (owner's ruling, 2026-09-11). Locations is the tab a member actually uses; Advanced
   * Settings holds how names are compared.
   *
   * EVERY PLACE IS A DROPDOWN OF WHAT IT SEARCHES (owner's rulings, 2026-11-09). Five places —
   * Directory, Files, Messaging, Tasks, Magnus — each opening onto the options it searches, open by
   * default so the reader sees the whole search at once. An option says WHAT it searches and nothing
   * else: no sentence about the firm's floor, no note on why an option exists. Files and Tasks offer
   * the four matter statuses, all on; Messaging splits Calls, Texts and Email the way the product
   * does; Magnus offers every employee's conversations.
   *
   * A PLACE THE ENGINE CANNOT SEARCH YET is drawn with its options, disabled and marked Soon, and the
   * check records it as not searched, so "never searched" is never read as "searched and found
   * nothing". The places search in parallel once they exist; the Directory is the one today.
   *
   * NOTHING HERE LIMITS THE SEARCH. A check follows every recorded relationship to closure, and the
   * one bound on a run is the platform's, stated on the record when it is reached.
   */
  import * as Accordion from "@magna-carta/design-system/accordion";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Label from "@magna-carta/design-system/label";
  import { MaturityBadge } from "@magna-carta/design-system/maturity";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import type { Strictness } from "./conflicts-api.ts";
  import type { CheckDraft } from "./check-draft.svelte.ts";
  import {
    NAME_MATCHING_LABEL,
    NAME_MATCHING_OPTIONS,
    SEARCH_LOCATIONS,
  } from "./conflicts-vocabulary.ts";

  let {
    draft,
    busy = false,
    tab = $bindable("locations"),
  }: {
    draft: CheckDraft;
    busy?: boolean;
    /** Which tab is showing. Bindable so a surface can open the pane on a particular one. */
    tab?: string;
  } = $props();

  const fieldPrefix = $props.id();

  // Every place opens on its options: the reader sees what the check will search without a click.
  let openPlaces = $state<string[]>(SEARCH_LOCATIONS.map((entry) => entry.location));

  const LOCKED = "Every check searches names and identifiers.";
  const SOON = "Not searchable yet. The check records it as not searched.";
</script>

<Tabs.Root bind:value={tab} class="flex flex-col gap-16">
  <Tabs.List>
    <Tabs.Trigger value="locations">Locations</Tabs.Trigger>
    <Tabs.Trigger value="advanced">Advanced Settings</Tabs.Trigger>
  </Tabs.List>

  <Tabs.Content value="locations">
    <Accordion.Root
      type="multiple"
      value={openPlaces}
      onValueChange={(value: string[]) => (openPlaces = value)} class="flex flex-col gap-8">
      {#each SEARCH_LOCATIONS as entry (entry.location)}
        <Accordion.Item
          value={entry.location}
          class="rounded-md border border-border-default"
          data-location={entry.location}
        >
          <Accordion.Trigger class="px-12">
            <span class="flex items-center gap-8">
              {entry.label}
              {#if !entry.searchable}
                <MaturityBadge stage="soon" />
              {/if}
            </span>
          </Accordion.Trigger>
          <Accordion.Content class="flex flex-col gap-8 px-12 pb-12">
            {#if entry.location === "directory"}
              <div class="flex items-center gap-8">
                <Checkbox id="{fieldPrefix}-source-party" checked disabled title={LOCKED} />
                <Label for="{fieldPrefix}-source-party">{entry.options[0]}</Label>
              </div>
              <div class="flex items-center gap-8">
                <Checkbox
                  id="{fieldPrefix}-source-graph"
                  bind:checked={draft.searchRelationships}
                  disabled={busy}
                />
                <Label for="{fieldPrefix}-source-graph">{entry.options[1]}</Label>
              </div>
              <div class="flex items-center gap-8">
                <Checkbox
                  id="{fieldPrefix}-source-imputation"
                  bind:checked={draft.searchOwnPeople}
                  disabled={busy}
                />
                <Label for="{fieldPrefix}-source-imputation">{entry.options[2]}</Label>
              </div>
            {:else}
              {#each entry.options as option (option)}
                {@const id = `${fieldPrefix}-${entry.location}-${option}`}
                <div class="flex items-center gap-8">
                  <Checkbox {id} checked={false} disabled title={SOON} />
                  <Label for={id}>{option}</Label>
                </div>
              {/each}
            {/if}
          </Accordion.Content>
        </Accordion.Item>
      {/each}
    </Accordion.Root>
  </Tabs.Content>

  <Tabs.Content value="advanced" class="flex flex-col gap-16">
    <div class="flex flex-col gap-8">
      <Label for="{fieldPrefix}-name-matching">{NAME_MATCHING_LABEL}</Label>
      <!-- A dropdown whose rows show a name each band catches: that is the whole explanation a band
           needs. -->
      <ChoicePicker
        options={NAME_MATCHING_OPTIONS}
        value={draft.nameMatching}
        inputId="{fieldPrefix}-name-matching"
        label={NAME_MATCHING_LABEL}
        disabled={busy}
        onchange={(value) => (draft.nameMatching = value as Strictness)}
      />
    </div>
  </Tabs.Content>
</Tabs.Root>
