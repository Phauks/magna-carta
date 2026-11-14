<script lang="ts">
  /*
   * The recipients search picker — ONE device, every composer (the change-request and
   * issue-report dialogs both address people): a combobox filtering the offered roster, each
   * pick added as its own removable chip, already-added people dropping out of the list. The
   * consumer owns the selected ids (and whether at least one is required); this component owns
   * only the picking mechanics.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import { badgeClasses } from "@magna-carta/design-system/badge";
  import X from "@lucide/svelte/icons/x";
  import {
    memberRoleLine,
    type FirmMemberSummary,
  } from "$lib/members/members-api.ts";

  let {
    members,
    selectedIds,
    onAdd,
    onRemove,
    inputId,
    placeholder = "Search staff…",
  }: {
    /** The roster this picker offers (the consumer scopes it — the active colleagues, or all). */
    members: readonly FirmMemberSummary[];
    selectedIds: readonly string[];
    onAdd: (id: string) => void;
    onRemove: (id: string) => void;
    /** The combobox input's id, so the consumer's Label can point at it. */
    inputId: string;
    placeholder?: string;
  } = $props();

  let query = $state("");

  const selectedMembers = $derived(
    members.filter((member) => selectedIds.includes(member.userId)),
  );

  // Only the not-yet-added remain pickable, narrowed by the typed query (name or role).
  const pickableMembers = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    return members
      .filter((member) => !selectedIds.includes(member.userId))
      .filter(
        (member) =>
          needle === "" ||
          member.displayName.toLowerCase().includes(needle) ||
          memberRoleLine(member).toLowerCase().includes(needle),
      );
  });

  function addPicked(value: string | string[]): void {
    const id = Array.isArray(value) ? (value[0] ?? "") : value;
    if (id === "") return;
    onAdd(id);
    // Reset the query for the next pick — the selection lives in the chips, not the combobox.
    query = "";
  }
</script>

{#if selectedMembers.length > 0}
  <!-- Each recipient is their own removable chip — a button wearing the badge recipe (a badge
       labels; the remove action needs a real control). -->
  <div class="flex flex-wrap items-center gap-4">
    {#each selectedMembers as member (member.userId)}
      <button
        type="button"
        class={badgeClasses({ variant: "neutral" })}
        aria-label="Remove {member.displayName}"
        onclick={() => onRemove(member.userId)}
      >
        {member.displayName}
        <X class="size-12" aria-hidden="true" />
      </button>
    {/each}
  </div>
{/if}
<!-- Keyed on the selection so each pick remounts a FRESH combobox: its internal single-select
     value is not consumer-bindable, and a stale internal value would treat re-picking a removed
     then re-offered person as a deselect. A remount per pick is cheap at roster scale and
     closes the listbox, which is the wanted rhythm (pick, chip lands, search again). -->
{#key selectedIds.join("|")}
  <Combobox.Root
    type="single"
    items={pickableMembers.map((member) => ({
      value: member.userId,
      label: member.displayName,
    }))}
    inputValue={query}
    onValueChange={addPicked}
  >
    <Combobox.Input
      id={inputId}
      {placeholder}
      oninput={(event) => (query = event.currentTarget.value)}
    />
    <Combobox.Content>
      {#each pickableMembers as member (member.userId)}
        {@const roleLine = memberRoleLine(member)}
        <Combobox.Item value={member.userId} label={member.displayName}>
          {member.displayName}
          <!-- The role line is what makes an unfiltered roster usable: a person picking whom to ask
               reads the seat beside the name. A member holding no role shows the name alone rather
               than a dash with nothing after it. -->
          {#if roleLine !== ""}
            <span class="text-text-muted">— {roleLine}</span>
          {/if}
        </Combobox.Item>
      {/each}
    </Combobox.Content>
  </Combobox.Root>
{/key}
