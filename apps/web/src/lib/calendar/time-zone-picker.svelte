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
   *
   * EVERY ROW IS THE SAME LINE — "(UTC-08:00) Pacific Standard Time · Los Angeles" — the display
   * vocabulary's one shape for a zone (time-zone-options.ts says why), worked out ON THE EVENT'S OWN
   * DAY, since the same zone is PST in January and PDT in July. The offset is what a reader checks
   * against a court's notice, the name is what tells three Centrals apart, and the place is what
   * they type. The code is not printed on the row but is what the search matches: "PST" finds Los
   * Angeles, and "pacific" or "los angeles" find it too. There was a `compact` mode that read the
   * FIELD by its code, for a 40-pixel slot at the end of the timing line; the slot is gone
   * (record-timing-fields.svelte: the zone is its own line now, wide enough to read), and with no
   * caller left the mode went with it.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import { matchingTimeZones, timeZoneLabel, timeZoneOptions } from "./time-zone-options.ts";

  let {
    value = $bindable(""),
    inputId,
    label,
    preferred,
    disabled = false,
    on = undefined,
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
    /**
     * The day the shortcode is worked out for. An abbreviation is a fact about a zone at a moment,
     * so the event's own day is the right one; today where the form has no date yet.
     */
    on?: Date;
  } = $props();

  /** What has been typed. Meaningful only while the field is being searched. */
  let query = $state("");
  /** Whether the reader is searching rather than reading the zone the field holds. */
  let searching = $state(false);

  const options = $derived(timeZoneOptions(preferred, undefined, on));

  // At rest the field names the zone it holds, so a filled field never reads as an empty one.
  const selectedLabel = $derived(value === "" ? "" : timeZoneLabel(value, on));

  const matching = $derived(matchingTimeZones(options, query));

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

<!-- A re-pick of the chosen zone confirms it; the primitive's default deselect would empty the
     field on the next click outside (matter-picker.svelte says it in full). -->
<Combobox.Root
  type="single"
  allowDeselect={false}
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
    <!-- The heading sits inside a group: a bare one has no identity to label and throws when the
         listbox opens, which is invisible until somebody clicks the field. -->
    {#if matching.length === 0}
      <Combobox.Group>
        <Combobox.GroupHeading>
          {options.length === 0
            ? "This browser cannot list its time zones."
            : `No time zone matches "${query.trim()}".`}
        </Combobox.GroupHeading>
      </Combobox.Group>
    {/if}
  </Combobox.Content>
</Combobox.Root>
