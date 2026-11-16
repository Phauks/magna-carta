<script lang="ts">
  /*
   * The product's ONE field for a closed choice — a set the firm did not write and cannot add to:
   * a call or a text, incoming or outgoing, the country a number belongs to, why a message is on no
   * matter.
   *
   * IT IS A COMBOBOX, NEVER A SELECT (owner ruling, 2026-09-08). Every place a person chooses from a
   * set, they can type to narrow it — which is the design system's own statement about its dropdown
   * (packages/design-system/src/lib/components/combobox/index.ts) and was true of the pickers over
   * the firm's OWN records long before it was true of the fixed ones. A two-row choice does not need
   * the search and loses nothing by having it; a two-hundred-row one is unusable without it, and a
   * reader should not have to learn which kind of list they are looking at before they know whether
   * typing will work.
   *
   * THE FIELD SHOWS WHAT IT HOLDS AT REST. Opening the list, or typing, starts a fresh search over
   * the whole set; closing it puts the chosen label back, so typed-but-unchosen text is never
   * mistaken for a value. Same discipline as $lib/time/matter-picker.svelte and
   * $lib/calendar/time-zone-picker.svelte, which pick over records rather than over a vocabulary.
   *
   * A SEARCH STARTS ON OPENING OR TYPING, NEVER ON FOCUS ALONE. Choosing the item that is already
   * chosen writes nothing (the primitive treats it as no change), so the label's restoration rests
   * on the close settling the text — which it does — and the primitive then returns focus to the
   * input. A search that began on every focus blanked the field again at exactly that moment, so
   * "united" typed over United States stood as the field's text after United States was re-picked
   * (owner-reported, 2026-09-14). Focus now only selects the text that is there, so typing still
   * replaces rather than appends; the reset itself waits for the list to open or a letter to land.
   *
   * THE SETTLE WRITES THE INPUT ITSELF. The typed text reaches the input from the keyboard, not
   * from this component, so the framework's record of what it last wrote there still says the
   * chosen label — and when the settle hands it that same label again it sees nothing to change
   * and writes nothing, leaving the typed text standing. That is the second half of the same
   * defect, and it shows only when the restored label is the one that was there before, which is
   * exactly the re-pick case. So the settle and the search reset put their text into the input
   * directly as well; the controlled `inputValue` still says the same thing for every other read.
   *
   * A ROW MAY CARRY MORE THAN ITS LABEL. The `row` snippet renders whatever the choice actually is —
   * a country's flag and its name beside its dial code — while the field itself keeps the short
   * label, because a field is one line and a row is not.
   */
  import type { Snippet } from "svelte";
  import * as Combobox from "@magna-carta/design-system/combobox";
  import { matchingChoices, type ChoiceOption } from "./choice-picker.ts";

  let {
    options,
    value = $bindable(""),
    inputId,
    label,
    disabled = false,
    title,
    whenNoMatch,
    row,
    onchange,
    fillsCell = false,
    invalid = false,
  }: {
    options: readonly ChoiceOption[];
    /** The chosen value, or the empty string where nothing is chosen. Bindable. */
    value?: string;
    /** The input's id, so the caller's Label points at it. */
    inputId?: string;
    /** The field's own name, which is also its ghost text. */
    label: string;
    disabled?: boolean;
    /** What the field says on its hover, which is where a refusal is worded. */
    title?: string;
    /** What the list says when nothing matches what was typed. */
    whenNoMatch?: (query: string) => string;
    /** How a row draws itself, where the label alone is not the whole choice. */
    row?: Snippet<[ChoiceOption]>;
    onchange?: (value: string) => void;
    /**
     * Take the width of whatever holds the field — a table cell, a sized wrapper — and claim none
     * of its own. A text input's default width is the browser's (about twenty characters), and in
     * a table that sizes its columns from their content that default becomes the column's floor,
     * so two pickers in one row can push a table past its frame and its last column out of sight.
     * The field still fills its holder exactly as before; it only stops asking for more.
     */
    fillsCell?: boolean;
    /**
     * The field stands refused: its edge turns red and nothing else changes. A refusal on a field
     * is a highlight and never a line of text, so the reason stays with the caller's own label.
     */
    invalid?: boolean;
  } = $props();

  /** What has been typed. Meaningful only while the field is being searched. */
  let query = $state("");
  /** Whether the reader is searching rather than reading the choice the field holds. */
  let searching = $state(false);

  const chosenLabel = $derived(
    options.find((option) => option.value === value)?.label ?? "",
  );
  const matching = $derived(matchingChoices(options, searching ? query : ""));

  /** The input element, for the two writes the framework cannot be relied on to make (see above). */
  let inputElement = $state<HTMLInputElement | null>(null);

  function settle(): void {
    searching = false;
    query = "";
    if (inputElement !== null) inputElement.value = chosenLabel;
  }

  /** Opening is asking to choose again: the whole set is on offer, not the one option sitting in the field. */
  function startSearch(): void {
    searching = true;
    query = "";
    if (inputElement !== null) inputElement.value = "";
  }

  function pick(picked: string | string[]): void {
    const chosen = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    settle();
    // Every vocabulary this field stands over has an answer for each record, so there is no row that
    // takes the answer back off: a field that could be emptied would be offering a fourth state a
    // call record cannot be in. A picker over the firm's own records is where "none" is real, and
    // that is $lib/time/matter-picker.svelte.
    if (chosen === "" || chosen === value) return;
    value = chosen;
    onchange?.(chosen);
  }
</script>

<Combobox.Root
  type="single"
  {disabled}
  allowDeselect={false}
  items={matching.map((option) => ({ value: option.value, label: option.label }))}
  {value}
  inputValue={searching ? query : chosenLabel}
  onValueChange={pick}
  onOpenChange={(open) => {
    if (open) startSearch();
    else settle();
  }}
>
  <Combobox.Input
    bind:ref={inputElement}
    id={inputId}
    fieldName={label}
    {title}
    aria-invalid={invalid ? "true" : undefined}
    autocomplete="off"
    spellcheck={false}
    size={fillsCell ? 1 : undefined}
    onfocus={(event) => {
      // Arriving selects what is there, so the first letter typed replaces the label rather than
      // appending to it. Nothing else: a focus that is the primitive returning to the input after a
      // close must leave the settled label standing.
      event.currentTarget.select();
    }}
    onblur={settle}
    oninput={(event) => {
      searching = true;
      query = event.currentTarget.value;
    }}
  />
  <Combobox.Content>
    <!-- A row draws itself only where it has more to say than its label: the Item falls back to the
         label when nothing is passed, and an empty snippet is not nothing. -->
    {#each matching as option (option.value)}
      {#if row !== undefined}
        <Combobox.Item value={option.value} label={option.label} title={option.meaning}>
          {@render row(option)}
        </Combobox.Item>
      {:else if option.aside !== undefined}
        <Combobox.Item value={option.value} label={option.label} title={option.meaning}>
          <span class="flex items-baseline gap-8">
            <span>{option.label}</span>
            <span class="text-xs text-text-muted">{option.aside}</span>
          </span>
        </Combobox.Item>
      {:else}
        <Combobox.Item value={option.value} label={option.label} title={option.meaning} />
      {/if}
    {/each}
    {#if matching.length === 0}
      <!-- The heading sits inside a group: a bare one has no identity to label and throws when the
           listbox opens, which is invisible until somebody narrows a list to nothing. -->
      <Combobox.Group>
        <Combobox.GroupHeading>
          {whenNoMatch === undefined
            ? `Nothing matches "${query.trim()}".`
            : whenNoMatch(query.trim())}
        </Combobox.GroupHeading>
      </Combobox.Group>
    {/if}
  </Combobox.Content>
</Combobox.Root>
