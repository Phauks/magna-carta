<script lang="ts">
  /*
   * A single-value picker over one of the firm's own vocabularies — its matter types, its
   * Locations. One component because the two fields ask the same question of the same shape, and a
   * copy per field is a copy of the data-safe pattern to keep in step.
   *
   * NOTHING CALLS IT TODAY, and that is recorded here rather than left to be discovered. Both of
   * the fields it was written for have since been answered by a piece that knows what it is
   * choosing: a practice area by practice-area-picker.svelte, which can also add one to the firm,
   * and an office by $lib/offices/office-picker.svelte, which reads the firm's offices itself and
   * cites each one. A third firm vocabulary shaped like these two is what this is still here for.
   *
   * The pattern is the design system's documented one for a single Combobox: the consumer owns the
   * input text, the typed query drives the filter, a pick writes the chosen label back, and closing
   * the listbox RESETS the text to whatever is actually selected. That last step is what keeps
   * typed-but-unchosen text from being mistaken for a value.
   *
   * Every one of these is optional. Clearing the field back to empty is a real answer — a matter
   * with no type and no Location is valid on the contract — so the empty state is not a failure to
   * choose, and the picker says so rather than refusing to be emptied.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";

  export interface VocabularyOption {
    id: string;
    name: string;
  }

  let {
    options,
    value = $bindable(null),
    inputId,
    label,
    whenEmpty,
  }: {
    options: readonly VocabularyOption[];
    /** The chosen identifier, or null for "not set". Bindable. */
    value?: string | null;
    /** The input's id, so the caller's Label points at it. */
    inputId: string;
    /** The field's own name, which is also its ghost text. */
    label: string;
    /** What to say when the firm has none of these yet. */
    whenEmpty: string;
  } = $props();

  let query = $state("");

  const selectedName = $derived(
    value === null ? "" : (options.find((option) => option.id === value)?.name ?? ""),
  );

  // Narrowed by the typed query. An empty query offers everything, so opening the list shows the
  // whole vocabulary rather than nothing.
  const matching = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return options;
    return options.filter((option) => option.name.toLowerCase().includes(needle));
  });

  function pick(picked: string | string[]): void {
    const id = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    value = id === "" ? null : id;
    query = id === "" ? "" : (options.find((option) => option.id === id)?.name ?? "");
  }
</script>

{#if options.length === 0}
  <p class="text-xs text-text-muted">{whenEmpty}</p>
{:else}
  <Combobox.Root
    type="single"
    items={matching.map((option) => ({ value: option.id, label: option.name }))}
    inputValue={query}
    onValueChange={pick}
    onOpenChange={(open) => {
      // Closing settles the text on the truth: the selected name, or empty when nothing is chosen.
      if (!open) query = selectedName;
    }}
  >
    <Combobox.Input
      id={inputId}
      placeholder={label}
      oninput={(event) => (query = event.currentTarget.value)}
    />
    <Combobox.Content>
      {#each matching as option (option.id)}
        <Combobox.Item value={option.id} label={option.name} />
      {/each}
    </Combobox.Content>
  </Combobox.Root>
{/if}
