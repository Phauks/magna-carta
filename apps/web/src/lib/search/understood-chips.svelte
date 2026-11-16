<script lang="ts">
  /*
   * What the Search page understood from the question, under the field: one chip per reading, each
   * removable, and a way back to the words as typed.
   *
   * A chip is a button that removes its reading, because removing is the one thing it does. It
   * wears the accent wash so a reading reads as something the page added, not something typed.
   */
  import X from "@lucide/svelte/icons/x";
  import type { UnderstoodChip } from "./question-reading.ts";

  let {
    chips,
    onRemove,
    onWordsOnly,
  }: {
    chips: readonly UnderstoodChip[];
    onRemove: (key: UnderstoodChip["key"]) => void;
    /** Present where there is a typed question to go back to. */
    onWordsOnly?: () => void;
  } = $props();
</script>

{#if chips.length > 0}
  <div class="flex flex-wrap items-center gap-8" role="group" aria-label="Understood from your search">
    <span class="text-sm whitespace-nowrap text-text-muted">Understood as</span>
    {#each chips as chip (chip.key)}
      <button
        type="button"
        class={[
          "inline-flex items-center gap-4 whitespace-nowrap rounded-full border border-accent-default bg-accent-subtle",
          "py-4 pr-8 pl-12 text-sm text-accent-subtle-foreground",
          "transition-colors duration-fast ease-standard hover:bg-surface-subtle",
        ]}
        aria-label="Remove {chip.label}: {chip.value}"
        onclick={() => onRemove(chip.key)}
      >
        <span class="text-text-muted">{chip.label}</span>
        <span>{chip.value}</span>
        <X class="size-12" aria-hidden="true" />
      </button>
    {/each}
    {#if onWordsOnly !== undefined}
      <button
        type="button"
        class="text-sm text-text-default underline underline-offset-2 hover:text-text-muted"
        onclick={onWordsOnly}
      >
        Search the Words Only
      </button>
    {/if}
  </div>
{/if}
