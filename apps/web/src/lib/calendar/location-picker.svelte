<script lang="ts">
  /*
   * WHERE A SETTING IS HELD, offered from the places the firm actually has.
   *
   * The field read "Where" and was a bare text box until the owner's round of 2026-09-14: "Where
   * should be location, and this should be a dropdown". Both halves of that are corrections. The
   * LABEL is the plain word for what the field holds — a place, not a question the form is asking —
   * and the CONTROL offers what the firm already knows about its own places, because a firm typing
   * "Conference Room B" for the fifteenth time is a firm whose own room list exists and is not
   * being used.
   *
   * IT IS A DROPDOWN-WITH-ADD, NOT A CLOSED SET (the standing rule for a vocabulary that is neither
   * closed nor free). A courthouse is not one of the firm's offices, and a deposition at opposing
   * counsel's is at no place this product holds a record of — so the firm's offices and rooms are
   * OFFERED, under headings that say which is which, and anything else is typed and kept. A closed
   * list here would refuse most of the hearings a litigation firm records.
   *
   * WHAT IT STORES IS TEXT. The record's column is free text (a courtroom, a department number, an
   * address) and deliberately not a foreign key into the firm's own locations, which drive
   * letterhead, remit-to and matter numbering; choosing an office fills the field with that office's
   * NAME. So there is nothing here that can dangle when a room is renamed, and nothing that has to
   * decide what a location means.
   *
   * A ROOM IS OFFERED UNDER THE OFFICE IT IS IN, and named by it where the firm has more than one
   * (owner, 2026-09-14: "A location may be Office 1, Room 1; Office 2, Room 2. Where offices are
   * distinct addresses, but rooms are not."). One office and a room is just a room; three offices
   * and a bare "Conference Room 1" names none of them. The grouping and the written name are
   * room-location.ts's answers, which is also what reads them back to book the room — so what this
   * field writes and what the booking finds cannot drift apart.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import type { LocationSummary } from "$lib/matters/matters-api.ts";
  import type { FirmResource } from "./calendar-api.ts";
  import { roomsByOffice } from "./room-location.ts";

  let {
    value = $bindable(""),
    inputId,
    label = "Location",
    locations = [],
    resources = [],
    disabled = false,
  }: {
    /** Where it is held, as text. Bindable. */
    value?: string;
    inputId: string;
    /** The field's own name, which is also its ghost text. */
    label?: string;
    /** The firm's offices. */
    locations?: readonly LocationSummary[];
    /** The firm's bookable things; only the rooms are places to hold a setting. */
    resources?: readonly FirmResource[];
    disabled?: boolean;
  } = $props();

  /** The offices' own group, and the heading rooms belonging to no office fall under. */
  const OFFICES_HEADING = "The firm's offices";
  const ROOMS_HEADING = "Rooms";

  /** What has been typed. Meaningful only while the field is being searched. */
  let query = $state("");
  /** Whether the reader is searching rather than reading the place the field holds. */
  let searching = $state(false);

  const offices = $derived(locations.map((location) => location.name));
  /** Every room the firm could hold a setting in, under its office, each with the name written. */
  const roomGroups = $derived(roomsByOffice(resources, locations, ROOMS_HEADING));

  const needle = $derived(searching ? query.trim().toLowerCase() : "");
  const matchingOffices = $derived(offices.filter((name) => name.toLowerCase().includes(needle)));
  /*
   * A room matches on the name a reader would type — its own — or on the one the field will write,
   * so typing "north" finds North Office's rooms and typing "boardroom" finds it in whichever
   * office it is in. An office with nothing matching is left out rather than drawn empty.
   */
  const matchingRoomGroups = $derived(
    roomGroups
      .map((group) => ({
        heading: group.heading,
        rooms: group.rooms.filter(
          (held) =>
            held.room.name.toLowerCase().includes(needle) ||
            held.written.toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.rooms.length > 0),
  );
  const offered = $derived([
    ...matchingOffices,
    ...matchingRoomGroups.flatMap((group) => group.rooms.map((held) => held.written)),
  ]);

  /** Whether what is typed is already one of the offered places, so the add row would repeat it. */
  const everyPlace = $derived([
    ...offices,
    ...roomGroups.flatMap((group) => group.rooms.map((held) => held.written)),
  ]);
  const typedIsOffered = $derived(
    query.trim() === "" ||
      everyPlace.some((name) => name.toLowerCase() === query.trim().toLowerCase()),
  );

  function settle(next: string): void {
    searching = false;
    query = "";
    value = next;
  }

  function pick(picked: string | string[]): void {
    const chosen = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    // The add row means "keep what I typed", which is already the whole of what this field holds.
    if (Combobox.isAddOption(chosen)) {
      settle(query.trim());
      return;
    }
    settle(chosen);
  }
</script>

<Combobox.Root
  type="single"
  {disabled}
  items={offered.map((name) => ({ value: name, label: name }))}
  value={offered.includes(value) ? value : ""}
  inputValue={searching ? query : value}
  onValueChange={pick}
  onOpenChange={(open) => {
    // Leaving keeps whatever was typed: a courthouse the firm has no record of is the ordinary
    // answer here, and a field that discarded it would refuse most hearings.
    if (!open) settle(searching && query.trim() !== "" ? query.trim() : value);
  }}
>
  <Combobox.Input
    id={inputId}
    fieldName={label}
    autocomplete="off"
    oninput={(event) => {
      searching = true;
      query = event.currentTarget.value;
    }}
  />
  <Combobox.Content>
    {#if matchingOffices.length > 0}
      <Combobox.Group>
        <Combobox.GroupHeading>{OFFICES_HEADING}</Combobox.GroupHeading>
        {#each matchingOffices as name (name)}
          <Combobox.Item value={name} label={name} />
        {/each}
      </Combobox.Group>
    {/if}
    <!-- A group per office, so two offices' worth of "Conference Room 1" read as two rooms. -->
    {#each matchingRoomGroups as group (group.heading)}
      <Combobox.Group>
        <Combobox.GroupHeading>{group.heading}</Combobox.GroupHeading>
        {#each group.rooms as held (held.room.id)}
          <Combobox.Item value={held.written} label={held.written} />
        {/each}
      </Combobox.Group>
    {/each}
    {#if !typedIsOffered}
      <Combobox.AddOption fieldName={label} {query} />
    {/if}
  </Combobox.Content>
</Combobox.Root>
