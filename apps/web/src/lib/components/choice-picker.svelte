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
   * THE FIELD SHOWS WHAT IT HOLDS AT REST. Arriving in it starts a fresh search over the whole set;
   * leaving it puts the chosen label back, so typed-but-unchosen text is never mistaken for a value.
   * Same discipline as $lib/time/matter-picker.svelte and $lib/calendar/time-zone-picker.svelte,
   * which pick over records rather than over a vocabulary.
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
  } = $props();

  /** What has been typed. Meaningful only while the field is being searched. */
  let query = $state("");
  /** Whether the reader is searching rather than reading the choice the field holds. */
  let searching = $state(false);

  const chosenLabel = $derived(
    options.find((option) => option.value === value)?.label ?? "",
  );
  const matching = $derived(matchingChoices(options, searching ? query : ""));

  function settle(): void {
    searching = false;
    query = "";
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
    if (!open) settle();
  }}
>
  <Combobox.Input
    id={inputId}
    fieldName={label}
    {title}
    autocomplete="off"
    spellcheck={false}
    onfocus={() => {
      // Arriving in the field is asking to choose again, so the whole set is on offer rather than
      // the one option whose name happens to be sitting in it.
      searching = true;
      query = "";
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
