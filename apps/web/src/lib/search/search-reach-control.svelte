<script lang="ts">
  /*
   * The Search page's "Search in" row: which matters the question is asked of.
   *
   * It sits beneath the field, where a matter's own search keeps its settings
   * ($lib/matters/matter-search-settings.svelte): writing the question above, aiming it below.
   *
   * FOUR CHOICES, AND ONE OF THEM LEAVES THE PAGE. Everything the reader can see, their own
   * matters, and one client's matters are asked here and ride in the address. One matter is not: a
   * matter's own search reaches more of that matter than this page does (the words inside its
   * files, its parties, its calendar), so choosing a matter opens that search with the same
   * question, and a reader is not given the shorter answer under the same name.
   *
   * IT OWNS NO CHOICE THAT HAS BEEN MADE. The reach is the address's, handed in and handed back.
   * What it holds is the one thing the address cannot: that the reader said "one client" or "one
   * matter" and has not yet said which.
   *
   * A CLIENT IS PICKED FROM THE DIRECTORY, AND NEVER MADE HERE. The field is the firm's one entity
   * picker with recording turned off: a search is narrowed to somebody the firm already holds.
   */
  import Label from "@magna-carta/design-system/label";
  import * as Select from "@magna-carta/design-system/select";
  import type { PickableEntity } from "@magna-carta/design-system/entity-picker";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import { readDirectoryEntityNames } from "$lib/directory/directory-api.ts";
  import DirectoryEntityPicker from "$lib/directory/directory-entity-picker.svelte";
  import { FirmMatters } from "$lib/time/firm-matters.svelte.ts";
  import MatterPicker from "$lib/time/matter-picker.svelte";
  import { EVERYTHING, MY_MATTERS, type SearchReach } from "./search-address.ts";
  import { REACH_CHOICES, clientNamed, type ReachChoice } from "./search-reach.ts";

  let {
    reach,
    onReach,
    onMatter,
  }: {
    /** The reach in force, read from the address. */
    reach: SearchReach;
    onReach: (next: SearchReach) => void;
    /** The reader chose one matter: its own search answers that. */
    onMatter: (matterId: string) => void;
  } = $props();

  const fieldId = $props.id();

  /** A choice that needs a second answer, said and not yet completed. */
  let pending = $state<"client" | "matter" | null>(null);
  const choice = $derived<ReachChoice>(pending ?? reach.kind);

  /** The client the address names, once the directory has said what to call them. */
  let named = $state<PickableEntity | null>(null);
  const client = $derived(
    reach.kind === "client" && named?.identifier === reach.entityId ? named : null,
  );

  // An address can arrive with a client in it (a reload, a link from a colleague), and the field
  // has to name who that is. Asked once per client, and a late answer for an earlier one is
  // dropped.
  $effect(() => {
    if (reach.kind !== "client") return;
    const entityId = reach.entityId;
    if (named?.identifier === entityId) return;
    let current = true;
    void readDirectoryEntityNames(fetch, [entityId]).then((outcome) => {
      if (current) named = clientNamed(entityId, outcome);
    });
    return () => {
      current = false;
    };
  });

  const firmMatters = new FirmMatters();
  $effect(() => {
    if (choice === "matter") void firmMatters.load(fetch);
  });

  function choose(next: ReachChoice): void {
    if (next === "everything" || next === "mine") {
      pending = null;
      onReach(next === "mine" ? MY_MATTERS : EVERYTHING);
      return;
    }
    // Choosing "one client" again while one is chosen changes nothing.
    pending = next === "client" && reach.kind === "client" ? null : next;
  }

  function pickClient(entity: PickableEntity): void {
    named = entity;
    pending = null;
    onReach({ kind: "client", entityId: entity.identifier });
  }

  function clearClient(): void {
    // The field stays, empty, for another client; the search goes back to everything meanwhile.
    pending = "client";
    if (reach.kind === "client") onReach(EVERYTHING);
  }
</script>

<div class="flex flex-wrap items-center gap-x-12 gap-y-8">
  <div class="flex min-w-0 items-center gap-8">
    <span class="flex-none text-xs text-text-muted">Search in</span>
    <Select.Root
      type="single"
      items={REACH_CHOICES.map((option) => ({ value: option.value, label: option.label }))}
      allowDeselect={false}
      bind:value={() => choice, (next) => choose(next as ReachChoice)}
    >
      <Select.Trigger aria-label="Search in">
        <Select.Value placeholder={placeholderOf("Matters")} />
      </Select.Trigger>
      <Select.Content>
        {#each REACH_CHOICES as option (option.value)}
          <Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  {#if choice === "client"}
    <div class="w-full sm:w-xs">
      <DirectoryEntityPicker
        value={client}
        label="Client"
        inputId="{fieldId}-client"
        allowCreate={false}
        onSelect={pickClient}
        onClear={clearClient}
      />
    </div>
  {:else if choice === "matter"}
    <div class="flex w-full flex-col gap-4 sm:w-xs">
      <Label for="{fieldId}-matter" class="sr-only">Matter</Label>
      <MatterPicker
        matters={firmMatters.matters ?? []}
        reading={firmMatters.matters === null}
        capped={firmMatters.capped}
        inputId="{fieldId}-matter"
        offerNoMatter={false}
        title="Opens that matter's own search, which also reads the words inside its files."
        onpick={(matterId) => {
          if (matterId !== null) onMatter(matterId);
        }}
      />
    </div>
  {/if}

  {#if choice === "matter" && firmMatters.failure !== null}
    <p class="w-full text-xs text-text-muted">The firm's matters could not be read just now.</p>
  {/if}
</div>
