<script lang="ts">
  /*
   * The one control that classifies an event: the catalog as a typeahead, labelled Type.
   *
   * The two record forms and the entry window's two event panes all ask this question and were
   * each drawing the control by hand; four copies of one control drift in their ids, their labels
   * and their empty behaviour. The items are the caller's (the active types, plus the record's own
   * where it is retired); this file renders them and decides nothing about which exist.
   *
   * IT IS A COMBOBOX, NOT A SELECT (owner ruling, 2026-09-14). A firm's catalog of event types runs
   * to dozens — every kind of hearing, conference, deposition and appearance it books — and a plain
   * select makes a person scroll a list to find one they could have typed three letters of. This is
   * the same control the zone field and the member pickers are, for the same reason: a long closed
   * list is typed at, not scrolled.
   *
   * THE LIST IS ALPHABETICAL, whatever order the catalog read hands over. A reader looking for
   * "Status Conference" is looking for it by name, and a list ordered by when somebody happened to
   * create each type is a list with no order at all.
   *
   * THE FIELD SHOWS WHAT IT HOLDS AT REST. Arriving in it starts a fresh search over every type;
   * leaving it puts the chosen type's name back. A filled field rendering its ghost text would read
   * as an event classified under nothing, which is a different and important fact. Same discipline
   * as time-zone-picker.svelte and $lib/matters/member-picker.svelte.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import Label from "@magna-carta/design-system/label";

  let {
    id,
    items,
    value,
    disabled = false,
    onchange,
  }: {
    /** Makes the ids this control mints unique on a page that may hold more than one form. */
    id: string;
    items: readonly { readonly value: string; readonly label: string }[];
    /** The chosen type's identifier, or null for an event classified under nothing. */
    value: string | null;
    disabled?: boolean;
    onchange: (value: string | null) => void;
  } = $props();

  /** The field's own name, which is also its ghost text and the name the list is announced by. */
  const FIELD_NAME = "Type";

  /** What has been typed. Meaningful only while the field is being searched. */
  let query = $state("");
  /** Whether the reader is searching rather than reading the type the field holds. */
  let searching = $state(false);

  const sorted = $derived(
    [...items].toSorted((left, right) => left.label.localeCompare(right.label)),
  );

  const selectedLabel = $derived(
    value === null ? "" : (sorted.find((item) => item.value === value)?.label ?? ""),
  );

  const matching = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return sorted;
    return sorted.filter((item) => item.label.toLowerCase().includes(needle));
  });

  /** Searching stops the moment a type is chosen, so the field goes back to naming it. */
  function settle(): void {
    searching = false;
    query = "";
  }

  function pick(picked: string | string[]): void {
    const chosen = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    onchange(chosen === "" ? null : chosen);
    settle();
  }
</script>

<div class="flex flex-col gap-8">
  <Label for={id}>{FIELD_NAME}</Label>
  <Combobox.Root
    type="single"
    disabled={disabled || items.length === 0}
    items={matching}
    value={value ?? ""}
    inputValue={searching ? query : selectedLabel}
    onValueChange={pick}
    onOpenChange={(open) => {
      if (!open) settle();
    }}
  >
    <Combobox.Input
      {id}
      fieldName={FIELD_NAME}
      autocomplete="off"
      spellcheck={false}
      onfocus={() => {
        // Arriving in the field is asking to search, so every type is on offer again rather than
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
      {#each matching as item (item.value)}
        <Combobox.Item value={item.value} label={item.label} />
      {/each}
      <!-- The heading sits inside a group: a bare one has no identity to label and throws when the
           listbox opens, which is invisible until somebody clicks the field. -->
      {#if matching.length === 0}
        <Combobox.Group>
          <Combobox.GroupHeading>
            {items.length === 0
              ? "The firm has no event types yet."
              : `No event type matches "${query.trim()}".`}
          </Combobox.GroupHeading>
        </Combobox.Group>
      {/if}
    </Combobox.Content>
  </Combobox.Root>
</div>
