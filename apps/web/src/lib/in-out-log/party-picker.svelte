<script lang="ts">
  /*
   * Picking a person for the In/Out Log: a member of the firm, somebody in the Directory, or a name
   * typed for somebody who is in neither (a courier, a client's neighbour).
   *
   * One field, because the desk does not know in advance which of the three a person is. Typing
   * narrows the firm's members in the browser, searches the Directory once typing pauses, and always
   * offers the typed text itself last, so a name is never refused for not being on file.
   *
   * IT PICKS, AND FORGETS. The chosen person is handed to the caller and the field clears, because
   * the form above it shows who was chosen.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import { searchDirectory, type DirectorySearchHit } from "$lib/directory/directory-api.ts";
  import { searchHitKindLabel } from "$lib/directory/entity-presentation.ts";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import type { InOutParty } from "./in-out-log-api.ts";

  let {
    inputId,
    fieldName,
    members,
    disabled = false,
    excluded = [],
    onPick,
  }: {
    inputId: string;
    fieldName: string;
    /** The firm's roster; departed members are left out here. */
    members: readonly FirmMemberSummary[];
    disabled?: boolean;
    /** People already chosen, as `member:<id>` or `entity:<id>`, so nobody is offered twice. */
    excluded?: readonly string[];
    onPick: (party: InOutParty) => void;
  } = $props();

  let query = $state("");
  let settledQuery = $state("");
  let hits = $state<readonly DirectorySearchHit[]>([]);
  let searchFailed = $state(false);

  const SETTLE_MILLISECONDS = 250;
  $effect(() => {
    const typed = query;
    const timer = setTimeout(() => (settledQuery = typed), SETTLE_MILLISECONDS);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    const asked = settledQuery.trim();
    if (asked === "") {
      hits = [];
      searchFailed = false;
      return;
    }
    let live = true;
    void (async () => {
      const outcome = await searchDirectory(fetch, asked);
      if (!live) return;
      hits = outcome.kind === "ok" ? outcome.value.data : [];
      searchFailed = outcome.kind !== "ok";
    })();
    return () => {
      live = false;
    };
  });

  interface Choice {
    value: string;
    label: string;
    kindLabel: string;
    party: InOutParty;
  }

  const choices = $derived.by((): Choice[] => {
    const typed = query.trim();
    const wanted = typed.toLowerCase();
    const memberChoices = members
      .filter((member) => member.status === "active")
      .filter((member) => wanted === "" || member.displayName.toLowerCase().includes(wanted))
      .slice(0, 8)
      .map((member) => ({
        value: `member:${member.userId}`,
        label: member.displayName,
        kindLabel: "Member",
        party: { kind: "member", userId: member.userId, entityId: null, name: member.displayName },
      }));
    const directoryChoices = hits.map((hit) => ({
      value: `entity:${hit.entityId}`,
      label: hit.displayName,
      kindLabel: searchHitKindLabel(hit.entityKind),
      party: { kind: "entity", userId: null, entityId: hit.entityId, name: hit.displayName },
    }));
    const typedChoice =
      typed === ""
        ? []
        : [
            {
              value: "external",
              label: typed,
              kindLabel: "Not on file",
              party: { kind: "external", userId: null, entityId: null, name: typed },
            },
          ];
    return [...memberChoices, ...directoryChoices, ...typedChoice].filter(
      (choice) => !excluded.includes(choice.value),
    ) as Choice[];
  });

  function pick(value: string | string[]): void {
    const chosen = Array.isArray(value) ? (value[0] ?? "") : value;
    const choice = choices.find((candidate) => candidate.value === chosen);
    if (choice === undefined) return;
    onPick(choice.party);
    query = "";
    settledQuery = "";
    hits = [];
  }
</script>

<Combobox.Root
  type="single"
  {disabled}
  items={choices.map((choice) => ({ value: choice.value, label: choice.label }))}
  inputValue={query}
  onValueChange={pick}
>
  <Combobox.Input
    id={inputId}
    {fieldName}
    autocomplete="off"
    oninput={(event) => (query = event.currentTarget.value)}
  />
  <Combobox.Content>
    {#each choices as choice (choice.value)}
      <Combobox.Item value={choice.value} label={choice.label}>
        {choice.label}
        <span class="text-text-muted">{choice.kindLabel}</span>
      </Combobox.Item>
    {/each}
  </Combobox.Content>
</Combobox.Root>

{#if searchFailed}
  <p class="text-xs text-text-muted">The Directory search could not be reached. A typed name still works.</p>
{/if}
