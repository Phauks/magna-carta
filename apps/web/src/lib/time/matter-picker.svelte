<script lang="ts">
  /*
   * Picking the matter a piece of time belongs to.
   *
   * It is the design system's one Combobox in the documented shape: the consumer owns the input
   * text, typing narrows the list, a pick writes the chosen matter back, and closing the listbox
   * resets the text to whatever is actually selected, so typed-but-unchosen text is never mistaken
   * for a value. Either half of a matter finds it — the number or the name — because a person
   * recording time knows one or the other and rarely both.
   *
   * THE FIELD SHOWS WHAT IT HOLDS AT REST. Opening the list is what starts a fresh search; leaving
   * it puts the chosen matter's name back. A filled field rendering its ghost text reads as a row
   * nobody has filed, which on this surface is a different and important fact.
   *
   * A SEARCH STARTS ON OPENING OR TYPING, NEVER ON FOCUS ALONE. Choosing the matter already chosen
   * writes nothing, so the name's restoration rests on the close settling the text, after which
   * the primitive returns focus to the input. A search that began on every focus blanked the
   * field again at exactly that moment and reopened the list, so typed text stood after the same
   * matter was re-picked ($lib/components/choice-picker.svelte carries the same correction, from
   * the owner's report of 2026-09-14). Arriving still opens the list — that is the one gesture a
   * person makes to see the record — but a focus handed back from the list after a pick is the
   * primitive's, not the person's, and is left alone.
   *
   * THE SETTLE WRITES THE INPUT ITSELF, for the reason choice-picker.svelte states in full: typed
   * text reaches the input from the keyboard, so the framework's record of what it last wrote
   * there still says the chosen name, and handing it that same name again writes nothing. The
   * settle and the search reset put their text into the input directly as well.
   *
   * NO MATTER IS A CHOICE, NOT AN ABSENCE. A person captures time before they know where it
   * belongs, so the list leads with a row that says so and takes the matter back off. Leaving it
   * blank by deleting the text would work too, but a choice somebody has to discover is a choice
   * most people never make. A record that cannot exist off a matter (a deadline is a deadline ON a
   * matter, and its table will not hold one without) turns the row off with `offerNoMatter`, so the
   * list never offers an answer the commit will then refuse.
   *
   * A CALLER MAY ADD ANSWERS THAT ARE NOT MATTERS. The call log asks one question — where does this
   * belong — and three of its answers are not matters at all: spam, the firm's own business, a
   * prospect nothing came of. Those arrive as `extraChoices` under their own heading, so the reader
   * types into ONE field and gets every answer the question has (owner ruling, 2026-09-08), rather
   * than choosing a category in one control and then a matter in a second one that appears. The
   * picker stays the common component either way; nothing about a matter is duplicated to add them.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import { matterDisplay, matterMatches, type SheetMatter } from "./time-sheet-model.ts";

  /**
   * The reserved value the "No matter" row reports.
   *
   * A matter identifier is minted as `matter_…`, so this can never collide with one; it is spelled
   * here once rather than at each place that compares against it.
   */
  const NO_MATTER_VALUE = "no-matter";

  let {
    matters,
    value = null,
    inputId,
    disabled = false,
    title,
    capped = false,
    reading = false,
    noMatterLabel = "No matter",
    offerNoMatter = true,
    extraChoices = [],
    extraHeading,
    extraValue = null,
    onpick,
    onpickExtra,
  }: {
    /** The firm's matters, as they were read. Narrowing happens here, not at the caller. */
    matters: readonly SheetMatter[];
    /** The chosen matter's identifier, or null for a row nobody has filed yet. */
    value?: string | null;
    /** The input's id, so a caller's Label points at it. */
    inputId?: string;
    disabled?: boolean;
    /** What the field says on its hover, which is where a refusal is worded. */
    title?: string;
    /** Whether the list is a page of the record rather than all of it, so the panel can say so. */
    capped?: boolean;
    /**
     * Whether the firm's matters are still being read.
     *
     * An empty list means two different things and the panel must not say the wrong one: a firm
     * with nothing to file on, and a walk that has not come back yet. They look identical from
     * here, so the caller — which holds the read — says which. Default false, because a caller that
     * hands over a list it already has is never in the second state.
     */
    reading?: boolean;
    /** What the row that takes it off every matter is called, where "No matter" is not the words. */
    noMatterLabel?: string;
    /** Whether the list offers that row at all. Off where the record must belong to a matter. */
    offerNoMatter?: boolean;
    /** Answers that are not matters, offered after them under `extraHeading`. */
    extraChoices?: readonly { value: string; label: string; meaning?: string }[];
    /** What those answers are called as a group, so a reader knows they are not matters. */
    extraHeading?: string;
    /** The extra answer the field holds, so it names that rather than showing empty. */
    extraValue?: string | null;
    /** Called with the chosen matter, or null where the row was taken back off a matter. */
    onpick: (matterId: string | null) => void;
    /** Called with an extra answer, which is never a matter and never writes `value`. */
    onpickExtra?: (value: string) => void;
  } = $props();

  /** What has been typed. Meaningful only while the field is being searched. */
  let query = $state("");
  /** The list is a controlled open: arriving in the field shows everything, typing narrows. */
  let listOpen = $state(false);
  /**
   * Whether the reader is searching rather than reading the row's matter.
   *
   * Without it, a row already filed narrows the firm's matters to the one it is already on, and the
   * only way to name another is to empty the field first.
   */
  let searching = $state(false);

  const selectedText = $derived.by(() => {
    if (extraValue !== null) {
      return extraChoices.find((choice) => choice.value === extraValue)?.label ?? "";
    }
    const chosen = matters.find((matter) => matter.id === value);
    return chosen === undefined ? "" : matterDisplay(chosen);
  });

  const matching = $derived(matters.filter((matter) => matterMatches(matter, query)));
  const matchingExtras = $derived(
    extraChoices.filter((choice) => choice.label.toLowerCase().includes(query.trim().toLowerCase())),
  );

  /**
   * Whether a focus is the primitive handing the input back after a pick, rather than a person
   * arriving. Focus that returns from the list carries the list as where it came from; a person
   * arrives from somewhere outside it, or from nowhere. The list closing is not the signal — the
   * primitive also closes it when a person leaves the field, and their return must still open it.
   */
  function focusReturnsFromList(event: FocusEvent): boolean {
    const origin = event.relatedTarget;
    return origin instanceof Element && origin.closest('[role="listbox"], [role="option"]') !== null;
  }

  /** The input element, for the two writes the framework cannot be relied on to make (see above). */
  let inputElement = $state<HTMLInputElement | null>(null);

  function settle(): void {
    searching = false;
    query = "";
    if (inputElement !== null) inputElement.value = selectedText;
  }

  /** The whole record is on offer, not the one matter in the field. */
  function startSearch(): void {
    searching = true;
    query = "";
    if (inputElement !== null) inputElement.value = "";
  }

  /** Opening is asking to search. */
  function openForSearch(): void {
    startSearch();
    listOpen = true;
  }

  function pick(picked: string | string[]): void {
    const chosen = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    settle();
    if (extraChoices.some((choice) => choice.value === chosen)) {
      onpickExtra?.(chosen);
      return;
    }
    onpick(chosen === "" || chosen === NO_MATTER_VALUE ? null : chosen);
  }
</script>

  <!-- A re-pick of the chosen row is a confirmation, never a deselect: the primitive's own default
       clears the value and leaves the list open, so the next click outside settled an empty field
       (owner, 2026-09-18: "if I select an item and try to click outside the dropdown, it reverts to
       an empty field"). Clearing is a row of its own where this field offers one. -->
<Combobox.Root
  type="single"
  allowDeselect={false}
  {disabled}
  items={[
    ...(offerNoMatter ? [{ value: NO_MATTER_VALUE, label: noMatterLabel }] : []),
    ...matching.map((matter) => ({ value: matter.id, label: matterDisplay(matter) })),
    ...matchingExtras.map((choice) => ({ value: choice.value, label: choice.label })),
  ]}
  value={extraValue ?? value ?? ""}
  inputValue={searching ? query : selectedText}
  open={listOpen}
  onValueChange={pick}
  onOpenChange={(open) => {
    listOpen = open;
    if (open) startSearch();
    else settle();
  }}
>
  <Combobox.Input
    bind:ref={inputElement}
    id={inputId}
    fieldName="Matter"
    {title}
    autocomplete="off"
    spellcheck={false}
    onfocus={(event) => {
      // A person arriving in the field is asking to search, so the whole record is on offer at
      // once rather than the one matter whose name happens to be sitting in it — the list opens
      // before a letter is typed, and typing narrows it. The focus the primitive hands back from
      // the list after a pick is not that, and leaves the settled name and the shut list alone.
      if (focusReturnsFromList(event)) return;
      openForSearch();
    }}
    onclick={() => {
      if (!listOpen) openForSearch();
    }}
    onblur={settle}
    oninput={(event) => {
      searching = true;
      query = event.currentTarget.value;
      listOpen = true;
    }}
  />
  <Combobox.Content>
    {#if offerNoMatter}
      <Combobox.Item value={NO_MATTER_VALUE} label={noMatterLabel} />
    {/if}
    {#each matching as matter (matter.id)}
      <Combobox.Item value={matter.id} label={matterDisplay(matter)} />
    {/each}
    {#if matchingExtras.length > 0}
      <!-- Not matters, and said so above them: a reader who has just typed a word that matches both
           a case and a reason has to be able to tell which row is which. -->
      <Combobox.Group>
        {#if extraHeading !== undefined}
          <Combobox.GroupHeading>{extraHeading}</Combobox.GroupHeading>
        {/if}
        {#each matchingExtras as choice (choice.value)}
          <Combobox.Item value={choice.value} label={choice.label} title={choice.meaning} />
        {/each}
      </Combobox.Group>
    {/if}
    <!-- A HEADING SITS INSIDE A GROUP. The group is where the heading finds the identity it labels,
         so a bare one throws the moment the listbox opens — which is invisible until somebody
         clicks the field, and is exactly how this picker crashed the Messaging screen. -->
    {#if matching.length === 0 && matchingExtras.length === 0}
      <Combobox.Group>
        <Combobox.GroupHeading>
          {matters.length === 0 && reading
            ? "Reading the firm's matters."
            : matters.length === 0
              ? "No matters were read, so there is nothing to file this on."
              : `No matter matches "${query.trim()}".`}
        </Combobox.GroupHeading>
      </Combobox.Group>
    {:else if capped}
      <!-- A capped answer says it is capped: this is a page of the firm's matters, not the whole
           record, so a matter that is genuinely there can be genuinely missing from this list. -->
      <Combobox.Group>
        <Combobox.GroupHeading>
          More matters exist than were read. Type to narrow what is here.
        </Combobox.GroupHeading>
      </Combobox.Group>
    {/if}
  </Combobox.Content>
</Combobox.Root>
