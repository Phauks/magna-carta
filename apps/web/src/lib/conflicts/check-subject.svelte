<script lang="ts">
  /*
   * The New Check panel's LEFT pane: who the check is about, and what pressing Run will do.
   *
   * The owner's direction, 2026-09-08: "left would be general information, right would be advanced
   * and technical settings. left side is the input. right side is the engine settings." So this
   * pane holds the two things a member always fills in — the parties, and where the check is filed
   * — and nothing else. Everything that tunes the search is one pane over.
   *
   * A CHECK DOES NOT NEED A MATTER. The owner again: "a conflict check does not need to check
   * against a matter, the whole point is to find the matters that are potential conflicts." The
   * matter is not what a check runs AGAINST; it is where the check is filed, and once a party is
   * chosen the field offers the matters that party is on (matter-choice.svelte). The field never
   * refuses a check for being without one: the pre-engagement screen, where all anybody has is a
   * name given over the telephone, is the case the whole preliminary trigger exists for.
   *
   * THE PANE SAYS LESS THAN IT DID (owner's ruling, 2026-09-11). No line of explanation under a
   * field. What remains is the read-back: the sentences under the fields say what will actually
   * run, composed from the very values the request is composed from, so they can never describe a
   * search other than the one that runs.
   */
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Label from "@magna-carta/design-system/label";
  import DirectoryEntityPicker from "$lib/directory/directory-entity-picker.svelte";
  import { directoryPickerSearch } from "$lib/directory/directory-picker-source.ts";
  import type { CheckDraft } from "./check-draft.svelte.ts";
  import MatterChoice from "./matter-choice.svelte";

  let {
    draft,
    chooseMatter = false,
    matterLabel = null,
    plan,
    busy = false,
  }: {
    draft: CheckDraft;
    /** Whether this pane asks which matter. The firm-wide log does; a matter's own section cannot. */
    chooseMatter?: boolean;
    /** How the surface's own matter reads, where it has one. */
    matterLabel?: string | null;
    /** What the check will do, in sentences, composed from the draft the panel will send. */
    plan: readonly string[];
    /** True while the panel's commit is in flight, so every field holds still. */
    busy?: boolean;
  } = $props();

  const fieldPrefix = $props.id();
  const partySearch = directoryPickerSearch(fetch);
</script>

<div class="flex flex-col gap-24">
  <section class="flex flex-col gap-16">
    <FieldLabel as="h4">Who The Check Is About</FieldLabel>

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

    {#if chooseMatter}
      <div class="flex flex-col gap-8">
        <Label for="{fieldPrefix}-matter">Matter</Label>
        <MatterChoice
          subjectEntityIds={draft.subjectEntityIds}
          value={draft.chosenMatter}
          inputId="{fieldPrefix}-matter"
          disabled={busy}
          placeholder="Matter"
          onpick={(matter) => (draft.chosenMatter = matter)}
        />
      </div>
    {:else if matterLabel !== null}
      <div class="flex flex-col gap-8">
        <Label>Matter</Label>
        <p class="text-sm">{matterLabel}</p>
      </div>
    {/if}
  </section>

  <section class="flex flex-col gap-8 border-t border-border-default pt-16">
    <FieldLabel as="h4">What This Check Will Do</FieldLabel>
    <ul class="flex flex-col gap-4 text-xs text-text-muted">
      {#each plan as sentence (sentence)}
        <li>{sentence}</li>
      {/each}
    </ul>
  </section>
</div>
