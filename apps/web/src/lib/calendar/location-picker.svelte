<script lang="ts">
  /*
   * WHERE A SETTING IS HELD, offered from the places the firm actually has and the places it deals
   * with.
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
   * counsel's is at no place this product holds a record of — so what the firm knows is OFFERED,
   * under headings that say which is which, and anything else is typed and kept. A closed list
   * here would refuse most of the hearings a litigation firm records.
   *
   * FOUR KINDS OF PLACE (owner, 2026-09-18: "location only shows rooms, but what about choosing
   * locations such as buildings, addresses, the like"):
   *
   *   - THE FIRM'S OFFICES, each with its street address, because a hearing "at the North Office"
   *     should say where that is to whoever reads the record. Choosing one writes the name and the
   *     address.
   *   - ITS ROOMS, under the office each is in.
   *   - THE DIRECTORY'S ORGANIZATIONS — a court, opposing counsel's firm, a mediator's office —
   *     found by the same ranked search every other picker over the directory uses, once two
   *     letters are typed. Choosing one writes its name.
   *   - AN ADDRESS OR A PLACE NOBODY HAS A RECORD OF, typed and kept through the add row.
   *
   * WHAT IT STORES IS TEXT. The record's column is free text (a courtroom, a department number, an
   * address) and deliberately not a foreign key into the firm's own locations, which drive
   * letterhead, remit-to and matter numbering. So there is nothing here that can dangle when a
   * room is renamed, and nothing that has to decide what a location means.
   *
   * A ROOM IS OFFERED UNDER THE OFFICE IT IS IN, and named by it where the firm has more than one
   * (owner, 2026-09-14: "A location may be Office 1, Room 1; Office 2, Room 2. Where offices are
   * distinct addresses, but rooms are not."). One office and a room is just a room; three offices
   * and a bare "Conference Room 1" names none of them. The grouping and the written name are
   * room-location.ts's answers, which is also what reads them back to book the room — so what this
   * field writes and what the booking finds cannot drift apart.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import type { EntitySearch, PickableEntity } from "@magna-carta/design-system/entity-picker";
  import { directoryPickerSearch } from "$lib/directory/directory-picker-source.ts";
  import { officeAddressLine } from "$lib/offices/office-vocabulary.ts";
  import type { FirmResource } from "./calendar-api.ts";
  import { roomsByOffice, type OfficePlace } from "./room-location.ts";

  let {
    value = $bindable(""),
    inputId,
    label = "Location",
    locations = [],
    resources = [],
    directorySearch = null,
    disabled = false,
  }: {
    /** Where it is held, as text. Bindable. */
    value?: string;
    inputId: string;
    /** The field's own name, which is also its ghost text. */
    label?: string;
    /** The firm's offices, with their addresses where known. */
    locations?: readonly OfficePlace[];
    /** The firm's bookable things; only the rooms are places to hold a setting. */
    resources?: readonly FirmResource[];
    /**
     * How the directory is asked for a place. The firm's ranked search over organizations by
     * default; a test or a surface with no directory hands over its own, or `null` for none.
     */
    directorySearch?: EntitySearch | null;
    disabled?: boolean;
  } = $props();

  /** The offices' own group, the heading rooms belonging to no office fall under, the directory's. */
  const OFFICES_HEADING = "The firm's offices";
  const ROOMS_HEADING = "Rooms";
  const DIRECTORY_HEADING = "The directory";
  /** Letters typed before the directory is asked: one letter matches half the book. */
  const DIRECTORY_MINIMUM = 2;
  /** How long typing rests before the directory is asked, so a word is one request, not five. */
  const DIRECTORY_SETTLE_MS = 200;

  /** What has been typed. Meaningful only while the field is being searched. */
  let query = $state("");
  /** Whether the reader is searching rather than reading the place the field holds. */
  let searching = $state(false);

  /** The street address an office answers at, where it recorded one: the physical, else the mailing. */
  function officeAddress(office: OfficePlace): string {
    const addresses = office.addresses ?? [];
    const address =
      addresses.find((held) => held.kind === "physical") ??
      addresses.find((held) => held.kind === "mailing");
    return officeAddressLine(address);
  }

  /** An office as the field writes it: its name, and where that is. */
  function officeWritten(office: OfficePlace): string {
    const address = officeAddress(office);
    return address === "" ? office.name : `${office.name}, ${address}`;
  }

  const offices = $derived(
    locations.map((office) => ({
      id: office.id,
      name: office.name,
      address: officeAddress(office),
      written: officeWritten(office),
    })),
  );
  /** Every room the firm could hold a setting in, under its office, each with the name written. */
  const roomGroups = $derived(roomsByOffice(resources, locations, ROOMS_HEADING));

  const needle = $derived(searching ? query.trim().toLowerCase() : "");
  const matchingOffices = $derived(
    offices.filter(
      (office) =>
        office.name.toLowerCase().includes(needle) || office.address.toLowerCase().includes(needle),
    ),
  );
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

  // ---- the directory ---------------------------------------------------------------------------
  //
  // Asked once typing rests, for organizations only — a person is not a place — and only while the
  // reader is searching. An answer that arrives after a newer question was asked is dropped, so
  // the rows never show the previous word's courts under this word.

  const search = $derived(
    directorySearch ?? directoryPickerSearch(fetch, { kinds: ["organization"] }),
  );
  let directoryHits = $state<readonly PickableEntity[]>([]);
  let directoryCapped = $state(false);
  let directoryFailed = $state(false);
  let asked = 0;

  $effect(() => {
    const wanted = needle;
    const ask = search;
    asked += 1;
    const sequence = asked;
    if (wanted.length < DIRECTORY_MINIMUM) {
      directoryHits = [];
      directoryCapped = false;
      directoryFailed = false;
      return;
    }
    const timer = setTimeout(() => {
      void ask(wanted, new AbortController().signal)
        .then((answer) => {
          if (sequence !== asked) return;
          directoryHits = answer.hits;
          directoryCapped = answer.capped;
          directoryFailed = false;
        })
        .catch(() => {
          if (sequence !== asked) return;
          directoryHits = [];
          directoryCapped = false;
          directoryFailed = true;
        });
    }, DIRECTORY_SETTLE_MS);
    return () => clearTimeout(timer);
  });

  const offered = $derived([
    ...matchingOffices.map((office) => office.written),
    ...matchingRoomGroups.flatMap((group) => group.rooms.map((held) => held.written)),
    ...directoryHits.map((hit) => hit.name),
  ]);

  /** Whether what is typed is already one of the offered places, so the add row would repeat it. */
  const everyPlace = $derived([
    ...offices.map((office) => office.written),
    ...roomGroups.flatMap((group) => group.rooms.map((held) => held.written)),
    ...directoryHits.map((hit) => hit.name),
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

<!-- A re-pick of the place already held confirms it; the primitive's default deselect would clear
     the location on the next click outside ($lib/time/matter-picker.svelte says it in full). -->
<Combobox.Root
  type="single"
  allowDeselect={false}
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
        {#each matchingOffices as office (office.id)}
          <!-- The name, and beneath it where that is: an office is a building, and the address is
               what a reader of the record needs. -->
          <Combobox.Item value={office.written} label={office.written}>
            <span class="flex min-w-0 flex-col">
              <span>{office.name}</span>
              {#if office.address !== ""}
                <span class="text-xs text-text-muted">{office.address}</span>
              {/if}
            </span>
          </Combobox.Item>
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
    {#if directoryHits.length > 0 || directoryFailed}
      <Combobox.Group>
        <Combobox.GroupHeading>{DIRECTORY_HEADING}</Combobox.GroupHeading>
        {#each directoryHits as hit (hit.identifier)}
          <Combobox.Item value={hit.name} label={hit.name}>
            <span class="flex min-w-0 flex-col">
              <span>{hit.name}</span>
              {#if hit.aside !== undefined}
                <span class="text-xs text-text-muted">{hit.aside}</span>
              {/if}
            </span>
          </Combobox.Item>
        {/each}
        {#if directoryCapped}
          <Combobox.GroupHeading>More match than are shown. Type more to narrow.</Combobox.GroupHeading>
        {/if}
        {#if directoryFailed}
          <Combobox.GroupHeading>Couldn't search the directory.</Combobox.GroupHeading>
        {/if}
      </Combobox.Group>
    {/if}
    {#if !typedIsOffered}
      <Combobox.AddOption fieldName={label} {query} />
    {/if}
  </Combobox.Content>
</Combobox.Root>
