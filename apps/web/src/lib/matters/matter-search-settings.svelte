<script lang="ts">
  /*
   * The matter search's settings row: what a query REACHES, as opposed to the query itself.
   *
   * ONE COMPONENT, TWO SEATS, and that is the whole reason it exists. The owner's arrangement puts
   * the field on top and the settings under it — in the header control that "under" is the downward
   * panel, and on the results page it is the row beneath the view's field. Those are two different
   * seats for the same object, and the first cut of the results page proved what happens when they
   * are two copies instead: the control moved its scope out of the field and the page did not, so
   * one product had two answers to where you say what you are searching.
   *
   * It owns no state. Both surfaces already hold the scope somewhere authoritative and disagree
   * about where — the control on its MatterSearch, the results page in the address — so this takes
   * the current values and hands back the changes, rather than keeping a third copy that could be
   * right when neither of theirs was.
   */
  import type { Snippet } from "svelte";
  import Badge from "@magna-carta/design-system/badge";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import * as Select from "@magna-carta/design-system/select";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import type { SearchScope } from "$lib/matters/matter-search.svelte.ts";

  let {
    scope,
    options,
    onScope,
    includeDeleted,
    deletedApplies,
    onIncludeDeleted,
    trailing,
  }: {
    /** The scope in force, read from whichever place the surface keeps it. */
    scope: string;
    options: readonly SearchScope[];
    onScope: (next: string) => void;
    includeDeleted: boolean;
    /**
     * Whether the deleted option means anything to what is being searched. Read off the SERVER'S
     * answer by both surfaces, never from a list held on the client — no part of the browser has to
     * know which sources have a deleted set.
     */
    deletedApplies: boolean;
    onIncludeDeleted: (next: boolean) => void;
    /** What sits at the row's inline end: a way onward, or a count of what came back. */
    trailing?: Snippet;
  } = $props();
</script>

<div class="flex flex-wrap items-center gap-x-12 gap-y-8">
  <div class="flex min-w-0 items-center gap-8">
    <span class="flex-none text-xs text-text-muted">Search in</span>
    <!-- The vocabulary names the matter and no wider: searching everything is the top bar's job,
         not this control's. A section with no source is present and DISABLED with the line saying
         what it waits on, never omitted — a reader who cannot find Time in the list learns nothing,
         where one who sees why it is not offered learns exactly where they stand. -->
    <Select.Root
      type="single"
      items={options.map((option) => ({ value: option.value, label: option.label }))}
      allowDeselect={false}
      bind:value={() => scope, (next) => onScope(next as string)}
    >
      <Select.Trigger aria-label="Search in">
        <Select.Value placeholder={placeholderOf("Scope")} />
      </Select.Trigger>
      <Select.Content>
        {#each options as option (option.value)}
          <Select.Item
            value={option.value}
            label={option.label}
            disabled={option.waitingOn !== undefined}
          >
            {option.label}
            {#if option.waitingOn !== undefined}
              <Badge variant="neutral" class="ms-auto">Soon</Badge>
            {/if}
          </Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  {#if deletedApplies}
    <!-- Off by default, and offered only where a selected source has a deleted set to offer. A
         deleted record joins the results MARKED as deleted; it never comes back looking live,
         because somebody would act on a document that is no longer in the matter. -->
    <label class="flex items-center gap-4 text-xs text-text-muted">
      <Checkbox
        bind:checked={() => includeDeleted, (next) => onIncludeDeleted(next === true)}
      />
      Include deleted
    </label>
  {/if}

  {#if trailing}
    <div class="ms-auto flex flex-none items-center">{@render trailing()}</div>
  {/if}
</div>
