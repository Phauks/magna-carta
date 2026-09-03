<script lang="ts">
  /*
   * Picking the zone a record's wall-clock times are read in.
   *
   * A hearing's zone is the court's and nothing about the firm can work it out, so the form asks —
   * with the likely answers first (the reader's own zone, the firm's offices) and then everything
   * the runtime can resolve, through time-zone-options.ts. The list is long, which is exactly why
   * this is a combobox rather than a select: a person types "denver" or "york" and the list narrows
   * to the zones whose name carries it.
   *
   * THE FIELD SHOWS WHAT IT HOLDS AT REST. Arriving in it starts a fresh search over every zone;
   * leaving it puts the chosen zone's name back. A filled field rendering its ghost text would read
   * as a record with no zone, which on a calendar is a different and important fact. Same
   * discipline as $lib/matters/member-picker.svelte, for the same reason.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import { timeZoneLabel, timeZoneOptions } from "./time-zone-options.ts";

  let {
    value = $bindable(""),
    inputId,
    label,
    preferred,
    disabled = false,
  }: {
    /** The chosen IANA zone, or empty for none. Bindable. */
    value?: string;
    /** The input's id, so the caller's Label points at it. */
    inputId: string;
    /** The field's own name, which is also its ghost text. */
    label: string;
    /** The zones offered first: the reader's own and the firm's offices, in that order. */
    preferred: readonly string[];
    disabled?: boolean;
  } = $props();

  /** What has been typed. Meaningful only while the field is being searched. */
  let query = $state("");
  /** Whether the reader is searching rather than reading the zone the field holds. */
  let searching = $state(false);

  const options = $derived(timeZoneOptions(preferred));

  const selectedLabel = $derived(value === "" ? "" : timeZoneLabel(value));

  const matching = $derived.by(() => {
    const needle = query.trim().toLowerCase().replaceAll("_", " ");
    if (needle === "") return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        option.value.toLowerCase().replaceAll("_", " ").includes(needle),
    );
  });

  /** Searching stops the moment a zone is chosen, so the field goes back to naming it. */
  function settle(): void {
    searching = false;
    query = "";
  }

  function pick(picked: string | string[]): void {
    const zone = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    value = zone;
    settle();
  }
</script>

<Combobox.Root
  type="single"
  {disabled}
  items={matching}
  {value}
  inputValue={searching ? query : selectedLabel}
  onValueChange={pick}
  onOpenChange={(open) => {
    if (!open) settle();
  }}
>
  <Combobox.Input
    id={inputId}
    fieldName={label}
    autocomplete="off"
    spellcheck={false}
    onfocus={() => {
      // Arriving in the field is asking to search, so every zone is on offer again rather than
      // the one whose name happens to be sitting in it.
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
    {#each matching as option (option.value)}
      <Combobox.Item value={option.value} label={option.label} />
    {/each}
    {#if matching.length === 0}
      <Combobox.GroupHeading>
        {options.length === 0
          ? "This browser cannot list its time zones."
          : `No time zone matches "${query.trim()}".`}
      </Combobox.GroupHeading>
    {/if}
  </Combobox.Content>
</Combobox.Root>
