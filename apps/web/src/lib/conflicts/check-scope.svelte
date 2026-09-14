<script lang="ts">
  /*
   * The New Check panel's RIGHT pane: where the check searches, and how it compares names.
   *
   * TWO TABS (owner's ruling, 2026-09-11). Locations is the tab a member actually uses: the places
   * the product can search, listed as places — Directory, Files, Messaging, Magnus — with what the
   * Directory search does beneath it behind a caret, so the reader chooses where first and tunes
   * how second. Advanced Settings holds the rest: how names are compared, and the two dimensions
   * that are not places. A pane that grows by stacking is a pane that has to be redesigned to grow
   * again; a place the product learns to search is one more entry in the list.
   *
   * THE PANE SAYS LESS (the same ruling). No line of explanation under a control. What a place
   * searches is its name; what a band catches is the example beside it in the dropdown. The one
   * sentence a control still carries is the one it owes: a place the product cannot search yet is
   * drawn, disabled, marked Soon, and says what it waits on — and the check records that place as
   * not searched, so a reader of the log can never mistake "never searched" for "searched and
   * nothing surfaced".
   *
   * NOTHING HERE LIMITS THE SEARCH. The hop budgets and the two caps are gone: a check follows every
   * recorded relationship to closure, and the one bound on a run is the platform's, stated on the
   * record when it is reached.
   *
   * A NARROWER CHOICE IS RAISED TO THE FIRM'S FLOOR, and the check records that it was. That is
   * the one thing the pane still states in words, because it is the difference between a setting
   * and a minimum.
   */
  import * as Accordion from "@magna-carta/design-system/accordion";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Label from "@magna-carta/design-system/label";
  import { MaturityBadge, soonControlProperties } from "@magna-carta/design-system/maturity";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import type { FirmConflictsPolicy, Strictness } from "./conflicts-api.ts";
  import type { CheckDraft } from "./check-draft.svelte.ts";
  import {
    ADVANCED_DIMENSIONS,
    DIRECTORY_SPECIFICS,
    NAME_MATCHING_LABEL,
    NAME_MATCHING_OPTIONS,
    SEARCH_LOCATIONS,
    sourceVocabulary,
    strictnessVocabulary,
  } from "./conflicts-vocabulary.ts";

  let {
    draft,
    policy = null,
    matterNamed = false,
    busy = false,
    tab = $bindable("locations"),
  }: {
    draft: CheckDraft;
    /** The firm's own floor, read so the pane can state what a narrower choice is raised to. */
    policy?: FirmConflictsPolicy | null;
    /** Whether the check names a matter. Without one there is nothing to impute against. */
    matterNamed?: boolean;
    busy?: boolean;
    /** Which tab is showing. Bindable so a surface can open the pane on a particular one. */
    tab?: string;
  } = $props();

  const fieldPrefix = $props.id();

  /** The Soon affordance for a place or a dimension the engine cannot search yet. */
  function soon(key: string, waitsOn: string) {
    return soonControlProperties(waitsOn, `${fieldPrefix}-${key}-waits`);
  }

  const floorSentence = $derived.by(() => {
    if (policy === null) return null;
    const sources = policy.floorSources.map((source) => sourceVocabulary(source).label).join(", ");
    const band = strictnessVocabulary(policy.floorStrictness).label.toLowerCase();
    return `This firm searches ${sources} at ${band} name matching or wider on every check. A narrower choice is raised back up before the search runs, and the check records that it was.`;
  });
</script>

<Tabs.Root bind:value={tab} class="flex flex-col gap-16">
  <Tabs.List>
    <Tabs.Trigger value="locations">Locations</Tabs.Trigger>
    <Tabs.Trigger value="advanced">Advanced Settings</Tabs.Trigger>
  </Tabs.List>

  <Tabs.Content value="locations" class="flex flex-col gap-16">
    <FieldLabel as="h4">Search Locations</FieldLabel>

    <ul class="flex flex-col gap-12">
      {#each SEARCH_LOCATIONS as entry (entry.location)}
        {#if entry.waitsOn === null}
          <li class="flex flex-col gap-8">
            <div class="flex items-center gap-8">
              <!-- Every check searches the Directory: it is the firm's floor, not a choice. -->
              <Checkbox
                id="{fieldPrefix}-{entry.location}"
                checked
                disabled
                title="Every check searches this. It is the firm-wide floor rather than a choice."
              />
              <Label for="{fieldPrefix}-{entry.location}">{entry.label}</Label>
            </div>
            <!-- The specifics sit beneath the place, behind a caret: where first, how second. -->
            <Accordion.Root type="multiple" class="ps-24">
              <Accordion.Item value="specifics">
                <Accordion.Trigger>What it searches there</Accordion.Trigger>
                <Accordion.Content class="flex flex-col gap-8">
                  {#each DIRECTORY_SPECIFICS as specific (specific.source)}
                    <div class="flex items-center gap-8">
                      {#if specific.source === "party"}
                        <Checkbox
                          id="{fieldPrefix}-source-party"
                          checked
                          disabled
                          title="Every check searches this. It is the firm-wide floor rather than a choice."
                        />
                      {:else if specific.source === "graph"}
                        <Checkbox
                          id="{fieldPrefix}-source-graph"
                          bind:checked={draft.searchRelationships}
                          disabled={busy}
                          title="Followed to closure: every recorded relationship, as far as the chain goes."
                        />
                      {:else}
                        <Checkbox
                          id="{fieldPrefix}-source-imputation"
                          bind:checked={draft.searchOwnPeople}
                          disabled={busy || !matterNamed}
                          title={matterNamed
                            ? undefined
                            : "No matter is named, so this check records it as not searched."}
                        />
                      {/if}
                      <Label for="{fieldPrefix}-source-{specific.source}">{specific.label}</Label>
                    </div>
                  {/each}
                  {#if !matterNamed}
                    <p class="text-xs text-text-muted">
                      No matter is named, so this check records the firm's own people as not
                      searched.
                    </p>
                  {/if}
                </Accordion.Content>
              </Accordion.Item>
            </Accordion.Root>
          </li>
        {:else}
          {@const affordance = soon(entry.location, entry.waitsOn)}
          <li class="flex flex-col gap-4">
            <div class="flex items-center gap-8">
              <Checkbox id="{fieldPrefix}-{entry.location}" checked={false} {...affordance} />
              <Label for="{fieldPrefix}-{entry.location}">{entry.label}</Label>
              <MaturityBadge stage="soon" />
            </div>
            <!-- The one line a Soon control owes: what it waits on. The check records the place as
                 not searched. -->
            <p id={affordance["aria-describedby"]} class="ps-24 text-xs text-text-muted">
              {affordance.title}
            </p>
          </li>
        {/if}
      {/each}
    </ul>
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

    <ul class="flex flex-col gap-12 border-t border-border-default pt-16">
      {#each ADVANCED_DIMENSIONS as dimension (dimension.source)}
        {@const affordance = soon(dimension.source, dimension.waitsOn)}
        <li class="flex flex-col gap-4">
          <div class="flex items-center gap-8">
            <Checkbox id="{fieldPrefix}-{dimension.source}" checked={false} {...affordance} />
            <Label for="{fieldPrefix}-{dimension.source}">
              {sourceVocabulary(dimension.source).label}
            </Label>
            <MaturityBadge stage="soon" />
          </div>
          <p id={affordance["aria-describedby"]} class="ps-24 text-xs text-text-muted">
            {affordance.title}
          </p>
        </li>
      {/each}
    </ul>

    {#if floorSentence !== null}
      <p class="border-t border-border-default pt-16 text-xs text-text-muted">{floorSentence}</p>
    {/if}
  </Tabs.Content>
</Tabs.Root>
