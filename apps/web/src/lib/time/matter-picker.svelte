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
   * THE FIELD SHOWS WHAT IT HOLDS AT REST. Arriving in it is what starts a fresh search; leaving it
   * puts the chosen matter's name back. A filled field rendering its ghost text reads as a row
   * nobody has filed, which on this surface is a different and important fact.
   *
   * NO MATTER IS A CHOICE, NOT AN ABSENCE. A person captures time before they know where it
   * belongs, so the list leads with a row that says so and takes the matter back off. Leaving it
   * blank by deleting the text would work too, but a choice somebody has to discover is a choice
   * most people never make.
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
    onpick,
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
    /** Called with the chosen matter, or null where the row was taken back off a matter. */
    onpick: (matterId: string | null) => void;
  } = $props();

  /** What has been typed. Meaningful only while the field is being searched. */
  let query = $state("");
  /**
   * Whether the reader is searching rather than reading the row's matter.
   *
   * Without it, a row already filed narrows the firm's matters to the one it is already on, and the
   * only way to name another is to empty the field first.
   */
  let searching = $state(false);

  const selectedText = $derived.by(() => {
    const chosen = matters.find((matter) => matter.id === value);
    return chosen === undefined ? "" : matterDisplay(chosen);
  });

  const matching = $derived(matters.filter((matter) => matterMatches(matter, query)));

  function settle(): void {
    searching = false;
    query = "";
  }

  function pick(picked: string | string[]): void {
    const chosen = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    settle();
    onpick(chosen === "" || chosen === NO_MATTER_VALUE ? null : chosen);
  }
</script>

<Combobox.Root
  type="single"
  {disabled}
  items={[
    { value: NO_MATTER_VALUE, label: "No matter" },
    ...matching.map((matter) => ({ value: matter.id, label: matterDisplay(matter) })),
  ]}
  value={value ?? ""}
  inputValue={searching ? query : selectedText}
  onValueChange={pick}
  onOpenChange={(open) => {
    if (!open) settle();
  }}
>
  <Combobox.Input
    id={inputId}
    fieldName="Matter"
    {title}
    autocomplete="off"
    spellcheck={false}
    onfocus={() => {
      // Arriving in the field is asking to search, so the whole record is on offer again rather
      // than the one matter whose name happens to be sitting in it.
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
    <Combobox.Item value={NO_MATTER_VALUE} label="No matter" />
    {#each matching as matter (matter.id)}
      <Combobox.Item value={matter.id} label={matterDisplay(matter)} />
    {/each}
    {#if matching.length === 0}
      <Combobox.GroupHeading>
        {matters.length === 0
          ? "No matters were read, so there is nothing to file this on."
          : `No matter matches "${query.trim()}".`}
      </Combobox.GroupHeading>
    {:else if capped}
      <!-- A capped answer says it is capped: this is a page of the firm's matters, not the whole
           record, so a matter that is genuinely there can be genuinely missing from this list. -->
      <Combobox.GroupHeading>
        More matters exist than were read. Type to narrow what is here.
      </Combobox.GroupHeading>
    {/if}
  </Combobox.Content>
</Combobox.Root>
