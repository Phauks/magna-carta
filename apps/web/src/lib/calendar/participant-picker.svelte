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
   * THE ROLE IS THE CHIP'S OWN SMALL FIELD. "Counsel for the defendant", "Presiding", "Reporter":
   * a word or two beside the name, optional, and typed after the pick rather than before it,
   * because the role is a fact about this event and the name is a fact about the person.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import { badgeClasses } from "@magna-carta/design-system/badge";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import X from "@lucide/svelte/icons/x";
  import { searchDirectory, type DirectorySearchHit } from "$lib/directory/directory-api.ts";
  import { searchHitKindLabel } from "$lib/directory/entity-presentation.ts";
  import { memberRoleLine, type FirmMemberSummary } from "$lib/members/members-api.ts";
  import {
    entityParticipant,
    externalParticipant,
    memberParticipant,
    type ParticipantDraft,
  } from "./event-draft.ts";

  type ParticipantSource = "member" | "entity" | "external";

  const SOURCES: readonly { value: ParticipantSource; label: string }[] = [
    { value: "member", label: "Firm member" },
    { value: "entity", label: "Directory" },
    { value: "external", label: "Someone else" },
  ];

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

  let source = $state<ParticipantSource>("member");

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

  let directoryQuery = $state("");
  let settledQuery = $state("");
  let hits = $state<readonly DirectorySearchHit[]>([]);
  let capped = $state(false);
  let searching = $state(false);
  let searchFailed = $state(false);

  // The typed query settles before it is sent: a Directory search per keystroke is a request per
  // keystroke, and the firm's own record is the authoritative match rather than the rows on screen.
  const SETTLE_MILLISECONDS = 250;
  $effect(() => {
    const typed = directoryQuery;
    const timer = setTimeout(() => (settledQuery = typed), SETTLE_MILLISECONDS);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    const asked = settledQuery.trim();
    if (asked === "") {
      hits = [];
      capped = false;
      searchFailed = false;
      return;
    }
    let live = true;
    searching = true;
    void (async () => {
      const outcome = await searchDirectory(fetch, asked);
      if (!live) return;
      searching = false;
      if (outcome.kind === "ok") {
        hits = outcome.value.data;
        capped = outcome.value.capped;
        searchFailed = false;
        return;
      }
      hits = [];
      capped = false;
      searchFailed = true;
    })();
    return () => {
      live = false;
    };
  });

  const offeredHits = $derived(hits.filter((hit) => !listedEntityIds.includes(hit.entityId)));

  function pickEntity(picked: string | string[]): void {
    const entityId = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    const hit = offeredHits.find((candidate) => candidate.entityId === entityId);
    if (hit === undefined) return;
    add(entityParticipant(hit.entityId, hit.displayName));
    directoryQuery = "";
    settledQuery = "";
    hits = [];
  }

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
  {#if participants.length > 0}
    <ul class="flex flex-col gap-8">
      {#each participants as participant (participant.key)}
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
          <Input
            class="w-3xs"
            aria-label="Role for {participant.displayName}"
            placeholder={placeholderOf("Role")}
            autocomplete="off"
            {disabled}
            value={participant.role}
            oninput={(event) => setRole(participant.key, event.currentTarget.value)}
          />
        </li>
      {/each}
    </ul>
  {/if}

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
          fieldName="Firm member"
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
          {#if offeredMembers.length === 0}
            <Combobox.GroupHeading>
              {members.length === 0
                ? "The roster could not be read."
                : "Nobody on the roster matches."}
            </Combobox.GroupHeading>
          {/if}
        </Combobox.Content>
      </Combobox.Root>
    {:else if source === "entity"}
      <Combobox.Root
        type="single"
        {disabled}
        items={offeredHits.map((hit) => ({ value: hit.entityId, label: hit.displayName }))}
        inputValue={directoryQuery}
        onValueChange={pickEntity}
      >
        <Combobox.Input
          id={inputId}
          fieldName="Directory"
          autocomplete="off"
          oninput={(event) => (directoryQuery = event.currentTarget.value)}
        />
        <Combobox.Content>
          {#each offeredHits as hit (hit.entityId)}
            <Combobox.Item value={hit.entityId} label={hit.displayName}>
              {hit.displayName}
              <span class="text-text-muted">&mdash; {searchHitKindLabel(hit.entityKind)}</span>
            </Combobox.Item>
          {/each}
          {#if searchFailed}
            <Combobox.GroupHeading>The Directory search could not be reached.</Combobox.GroupHeading>
          {:else if searching}
            <Combobox.GroupHeading>Searching the Directory.</Combobox.GroupHeading>
          {:else if capped}
            <Combobox.GroupHeading>
              More matches exist than are listed. Type more of the name.
            </Combobox.GroupHeading>
          {/if}
        </Combobox.Content>
      </Combobox.Root>
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
