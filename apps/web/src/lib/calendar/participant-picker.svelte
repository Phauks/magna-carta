<script lang="ts">
  /*
   * Who is at an event, picked from three places through one field.
   *
   * THREE SOURCES, ONE PICKER. A person at a hearing is a colleague from the roster, a client or
   * opposing counsel from the Directory, or somebody the firm will never make a record of: the
   * judge, a court reporter, a witness named once. Those are three kinds of handle on the record
   * (event-draft.ts builds each) and three different ways of finding them, but they are one
   * question on the form, so a segmented choice above ONE field decides where the next name comes
   * from, and every pick lands in the same list of chips whichever way it arrived.
   *
   * A NAME IS ADDED ONCE. The roster drops anybody already on the list, the Directory search
   * excludes them, and an external name is keyed on its spelling, so the same person cannot be
   * listed twice however they were reached. The draft's key is what decides sameness; this file
   * only refuses to add a key the list already holds.
   *
   * THE ROLE IS THE CHIP'S OWN SMALL FIELD. "Appearing counsel", "Judge", "Court reporter": a word
   * or two beside the name, optional, and answered after the pick rather than before it, because
   * the role is a fact about this event and the name is a fact about the person. It is
   * participant-role-field.svelte — the product's dropdown-with-add, not the bare text box it was,
   * which offered a reader nothing to tell them what belonged in it.
   *
   * THE CHIPS ARE BUNDLED BY WHERE THEY CAME FROM. One list of names said nothing about which were
   * colleagues, which were the firm's records and which were typed once (owner, 2026-09-18: "added
   * participants should be bundled into their source, so that people can tell if they were other,
   * staff, or directory related"). The bundles wear the picker's own words — Staff, Directory,
   * Other — and a bundle with nobody in it is not drawn (event-draft.ts, `participantsBySource`).
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import Button from "@magna-carta/design-system/button";
  import DirectoryEntityPicker from "$lib/directory/directory-entity-picker.svelte";
  import Input from "@magna-carta/design-system/input";
  import ParticipantRoleField from "./participant-role-field.svelte";
  import { badgeClasses } from "@magna-carta/design-system/badge";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import X from "@lucide/svelte/icons/x";
  import { directoryPickerSearch } from "$lib/directory/directory-picker-source.ts";
  import { memberRoleLine, type FirmMemberSummary } from "$lib/members/members-api.ts";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import {
    entityParticipant,
    externalParticipant,
    memberParticipant,
    participantsBySource,
    PARTICIPANT_SOURCES,
    type ParticipantDraft,
  } from "./event-draft.ts";
  import type { ParticipantKind } from "./calendar-api.ts";

  /** The three places a name comes from, in the draft's own words: Staff, Directory, Other. */
  const SOURCES: readonly { value: ParticipantKind; label: string }[] = PARTICIPANT_SOURCES.map(
    (source) => ({ value: source.kind, label: source.label }),
  );

  let {
    participants = $bindable(),
    members,
    inputId,
    disabled = false,
  }: {
    /** The people on the draft, as chips. Bindable; every add and removal writes back. */
    participants: ParticipantDraft[];
    /** The firm's roster. Departed colleagues are dropped here, not by the caller. */
    members: readonly FirmMemberSummary[];
    /** The active field's id, so the caller's Label points at whichever source is showing. */
    inputId: string;
    disabled?: boolean;
  } = $props();

  let source = $state<ParticipantKind>("member");

  /** The chips, bundled under the source each came from. */
  const bundles = $derived(participantsBySource(participants));

  /** The keys already on the list, joined; also what remounts the pickers after a pick. */
  const listedKeys = $derived(participants.map((participant) => participant.key));
  const listedEntityIds = $derived(
    participants.flatMap((participant) =>
      participant.entityId === null ? [] : [participant.entityId],
    ),
  );

  function add(participant: ParticipantDraft): void {
    if (participants.some((listed) => listed.key === participant.key)) return;
    participants = [...participants, participant];
  }

  function remove(key: string): void {
    participants = participants.filter((participant) => participant.key !== key);
  }

  function setRole(key: string, role: string): void {
    const index = participants.findIndex((participant) => participant.key === key);
    const current = participants[index];
    if (current === undefined) return;
    participants = participants.toSpliced(index, 1, { ...current, role });
  }

  // ---- firm members ----------------------------------------------------------------------------

  let memberQuery = $state("");

  const offeredMembers = $derived.by(() => {
    const needle = memberQuery.trim().toLowerCase();
    return members
      .filter(
        (member) =>
          member.status === "active" && !listedKeys.includes(memberParticipant(member.userId, "").key),
      )
      .filter(
        (member) =>
          needle === "" ||
          member.displayName.toLowerCase().includes(needle) ||
          memberRoleLine(member).toLowerCase().includes(needle),
      );
  });

  function pickMember(picked: string | string[]): void {
    const userId = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    const member = members.find((candidate) => candidate.userId === userId);
    if (member === undefined) return;
    add(memberParticipant(member.userId, member.displayName));
    memberQuery = "";
  }

  // ---- the Directory ---------------------------------------------------------------------------
  //
  // The one picker over the directory (design-system EntityPicker) fed by the one adapter
  // (`directoryPickerSearch`): the settle, the cap and the failure wording are its own, and what
  // this file adds is which handles are already on the list and where a pick lands.

  const directorySearch = directoryPickerSearch(fetch);

  // ---- somebody else ---------------------------------------------------------------------------

  let externalName = $state("");

  const externalReady = $derived(externalName.trim() !== "");

  function addExternal(): void {
    if (!externalReady) return;
    add(externalParticipant(externalName));
    externalName = "";
  }
</script>

<div class="flex flex-col gap-8">
  {#each bundles as bundle (bundle.kind)}
    <!-- One bundle per source with somebody in it, headed by the source's own word. -->
    <div class="flex flex-col gap-4">
      <FieldLabel as="p">{bundle.label}</FieldLabel>
      <ul class="flex flex-col gap-8" aria-label="{bundle.label} participants">
        {#each bundle.participants as participant (participant.key)}
          <li class="flex flex-wrap items-center gap-8">
            <!-- A button wearing the badge recipe: a badge labels, and the removal needs a real
                 control. Same device as $lib/components/recipient-picker.svelte. -->
            <button
              type="button"
              class={badgeClasses({ variant: "neutral" })}
              aria-label="Remove {participant.displayName}"
              {disabled}
              onclick={() => remove(participant.key)}
            >
              {participant.displayName}
              <X class="size-12" aria-hidden="true" />
            </button>
            <ParticipantRoleField
              accessibleName="Role for {participant.displayName}"
              {disabled}
              value={participant.role}
              onSettle={(role) => setRole(participant.key, role)}
            />
          </li>
        {/each}
      </ul>
    </div>
  {/each}

  <div class="flex items-center gap-4" role="group" aria-label="Where the next name comes from">
    {#each SOURCES as option (option.value)}
      <Button
        variant={source === option.value ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={source === option.value}
        {disabled}
        onclick={() => (source = option.value)}
      >
        {option.label}
      </Button>
    {/each}
  </div>

  <!-- Keyed on the list so each pick remounts a FRESH picker: a combobox's internal single value is
       not consumer-bindable, and a stale one would treat re-picking somebody removed and re-offered
       as a deselect. A remount per pick is cheap at this scale and closes the listbox, which is the
       wanted rhythm (pick, chip lands, search again). -->
  {#key listedKeys.join("|")}
    {#if source === "member"}
      <Combobox.Root
        type="single"
        allowDeselect={false}
        {disabled}
        items={offeredMembers.map((member) => ({
          value: member.userId,
          label: member.displayName,
        }))}
        inputValue={memberQuery}
        onValueChange={pickMember}
      >
        <Combobox.Input
          id={inputId}
          fieldName="Staff"
          autocomplete="off"
          oninput={(event) => (memberQuery = event.currentTarget.value)}
        />
        <Combobox.Content>
          {#each offeredMembers as member (member.userId)}
            {@const roleLine = memberRoleLine(member)}
            <Combobox.Item value={member.userId} label={member.displayName}>
              {member.displayName}
              {#if roleLine !== ""}
                <span class="text-text-muted">&mdash; {roleLine}</span>
              {/if}
            </Combobox.Item>
          {/each}
          <!-- The heading sits inside a group: a bare one has no identity to label and throws when
               the listbox opens, which is invisible until somebody clicks the field. -->
          {#if offeredMembers.length === 0}
            <Combobox.Group>
              <Combobox.GroupHeading>
                {members.length === 0
                  ? "The roster could not be read."
                  : "Nobody on the roster matches."}
              </Combobox.GroupHeading>
            </Combobox.Group>
          {/if}
        </Combobox.Content>
      </Combobox.Root>
    {:else if source === "entity"}
      <!-- Remounted per pick by the key above, so each pick starts the picker clean. -->
      <DirectoryEntityPicker
        search={directorySearch}
        excluded={listedEntityIds}
        label="Directory"
        {inputId}
        {disabled}
        onSelect={(entity) => add(entityParticipant(entity.identifier, entity.name))}
      />
    {:else}
      <div class="flex items-center gap-8">
        <Input
          id={inputId}
          placeholder={placeholderOf("Name")}
          autocomplete="off"
          {disabled}
          bind:value={externalName}
          onkeydown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            addExternal();
          }}
        />
        <Button variant="secondary" disabled={disabled || !externalReady} onclick={addExternal}>
          Add
        </Button>
      </div>
    {/if}
  {/key}
</div>
