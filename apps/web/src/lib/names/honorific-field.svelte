<script lang="ts">
  /*
   * The prefix and suffix control — one component, wherever a person's name is entered.
   *
   * WHY A DROPDOWN AT ALL, over a plain box: nine times in ten the answer is one of a dozen words,
   * and typing it invites the drift a name record cannot afford — "Jr", "Jr.", "JR" and "junior"
   * are one suffix spelled four ways, and they read as four on a letter and sort as four in a
   * listing. Offering the written form is what keeps the record's punctuation consistent without
   * anybody proofreading it.
   *
   * AND WHY IT STILL TAKES ANYTHING TYPED: the set of things people are called has no edge. A
   * closed list would refuse a person their own name, which is not a trade-off worth any amount of
   * tidiness. So the list is a suggestion (the honorifics module says so in its own header), the
   * stored column stays free text, and the combobox's own add row is the affordance that says the
   * typing counts.
   *
   * THE ONE DEPARTURE FROM THE CATEGORIES PICKER, which is otherwise this control's model: closing
   * the list settles the value on whatever is TYPED, not on what was picked. There, a typed word
   * nobody picked would mint a firm-wide category, so it must be a deliberate act; here there is
   * nothing to mint — the field is free text and what somebody typed is already a legitimate answer.
   * Losing it on close would be the control eating a name.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import type { LabelledFieldControlProperties } from "@magna-carta/design-system/labelled-field";
  import { honorificSuggestions } from "@magna-carta/directory/honorifics";

  let {
    part,
    value = $bindable(""),
    disabled = false,
    fieldName,
    inputProps,
  }: {
    /** Which half of the name this is; decides the suggestions and the default field name. */
    part: "prefix" | "suffix";
    /** The stored text. Free text: a suggestion is a shortcut to a value, never the only one. */
    value?: string;
    disabled?: boolean;
    /** Overrides the field's own name, for a surface that words it differently. */
    fieldName?: string;
    /** The props a LabelledField hands its control, so the label and the input stay wired. */
    inputProps?: LabelledFieldControlProperties;
  } = $props();

  const name = $derived(fieldName ?? (part === "prefix" ? "Prefix" : "Suffix"));
  const suggestions = $derived(honorificSuggestions(part));

  /*
   * What is typed, which the list filters against. It tracks `value` while the list is closed and
   * is the person's own text while they are typing — the two are the same thing at rest, and the
   * separation only exists so that narrowing the list does not have to mean rewriting the record on
   * every keystroke from a parent's point of view.
   */
  let query = $state(value);
  let open = $state(false);

  // The value settling from elsewhere (a record loading, a form resetting) re-seeds the text; a
  // person's own typing does not, because `query` is what they are typing.
  $effect(() => {
    if (!open) query = value;
  });

  const matching = $derived.by(() => {
    const typed = query.trim().toLowerCase();
    if (typed === "") return suggestions;
    return suggestions.filter((entry) => entry.toLowerCase().includes(typed));
  });

  /** Whether the typed text already IS one of the suggestions, in which case the add row is noise. */
  const typedIsSuggested = $derived(
    suggestions.some((entry) => entry.toLowerCase() === query.trim().toLowerCase()),
  );

  function pick(chosen: string | undefined): void {
    if (chosen === undefined) return;
    // The add row carries a reserved value rather than the text: what it means here is "keep what I
    // typed", which is what the field already holds.
    const settled = Combobox.isAddOption(chosen) ? query.trim() : chosen;
    value = settled;
    query = settled;
  }
</script>

<Combobox.Root
  type="single"
  {disabled}
  items={matching.map((entry) => ({ value: entry, label: entry }))}
  inputValue={query}
  onValueChange={pick}
  onOpenChange={(listboxOpen) => {
    open = listboxOpen;
    // Settling on the typed text, not on the last pick — see the departure noted above.
    if (!listboxOpen) value = query.trim();
  }}
>
  <Combobox.Input
    {...inputProps}
    fieldName={name}
    {disabled}
    oninput={(event) => (query = event.currentTarget.value)}
  />
  <Combobox.Content>
    {#each matching as entry (entry)}
      <Combobox.Item value={entry} label={entry} />
    {/each}
    {#if !typedIsSuggested}
      <Combobox.AddOption fieldName={name} {query} />
    {/if}
  </Combobox.Content>
</Combobox.Root>
