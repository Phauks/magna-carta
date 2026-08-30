<script lang="ts">
  /*
   * Who the check is about — the picker that turns a typed name into the Directory handles the
   * engine actually searches for.
   *
   * A conflicts check does not take names. It takes entity handles, and expands each one out
   * through the firm's recorded relationships, so a party that is not in the Directory cannot be
   * checked at all. That is why this is a picker over the firm's own record rather than a text
   * field: a free-text box would let somebody run a check against a name the engine never saw and
   * read the empty result as an answer.
   *
   * The search behind it is the Directory's fuzzy trigram match, tolerant of typos, so a party
   * spelled a little differently in intake still finds its record. Each pick becomes its own
   * removable chip; already-picked entities drop out of the list.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import { badgeClasses } from "@magna-carta/design-system/badge";
  import X from "@lucide/svelte/icons/x";
  import {
    searchDirectory,
    type DirectorySearchHit,
  } from "$lib/directory/directory-api.ts";
  import { searchHitKindLabel } from "$lib/directory/entity-presentation.ts";

  let {
    selected,
    onAdd,
    onRemove,
    inputId,
    disabled = false,
  }: {
    /** The parties picked so far. The consumer owns the set; this owns only the picking. */
    selected: readonly DirectorySearchHit[];
    onAdd: (hit: DirectorySearchHit) => void;
    onRemove: (entityId: string) => void;
    /** The combobox input's id, so the consumer's Label can point at it. */
    inputId: string;
    disabled?: boolean;
  } = $props();

  let query = $state("");
  let settledQuery = $state("");
  let results = $state<readonly DirectorySearchHit[]>([]);
  let capped = $state(false);
  let searching = $state(false);
  let searchFailed = $state(false);

  // The typed query settles before it is sent: a Directory search per keystroke is a request per
  // keystroke, and the firm's own record is the authoritative match rather than the rows on screen.
  $effect(() => {
    const typed = query;
    const timer = setTimeout(() => (settledQuery = typed), 250);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    const asked = settledQuery.trim();
    if (asked === "") {
      results = [];
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
        results = outcome.value.data;
        capped = outcome.value.capped;
        searchFailed = false;
        return;
      }
      // A search that could not run is stated rather than rendered as an empty Directory: the two
      // are the same picture and they are not the same fact.
      results = [];
      capped = false;
      searchFailed = true;
    })();
    return () => {
      live = false;
    };
  });

  const pickable = $derived(
    results.filter((hit) => !selected.some((picked) => picked.entityId === hit.entityId)),
  );

  function addPicked(value: string | string[]): void {
    const entityId = Array.isArray(value) ? (value[0] ?? "") : value;
    if (entityId === "") return;
    const hit = results.find((candidate) => candidate.entityId === entityId);
    if (hit === undefined) return;
    onAdd(hit);
    // The selection lives in the chips, so the box empties and is ready for the next party.
    query = "";
    settledQuery = "";
  }
</script>

{#if selected.length > 0}
  <!-- Each party is its own removable chip: a button wearing the badge recipe, because a badge
       labels and removing one needs a real control. -->
  <div class="flex flex-wrap items-center gap-4">
    {#each selected as party (party.entityId)}
      <button
        type="button"
        class={badgeClasses({ variant: "neutral" })}
        aria-label="Remove {party.displayName}"
        {disabled}
        onclick={() => onRemove(party.entityId)}
      >
        {party.displayName}
        <X class="size-12" aria-hidden="true" />
      </button>
    {/each}
  </div>
{/if}

<!-- Keyed on the selection so each pick remounts a fresh combobox: its internal single-select value
     is not consumer-bindable, and a stale one would treat re-picking a removed party as a deselect. -->
{#key selected.map((party) => party.entityId).join("|")}
  <Combobox.Root
    type="single"
    {disabled}
    items={pickable.map((hit) => ({ value: hit.entityId, label: hit.displayName }))}
    inputValue={query}
    onValueChange={addPicked}
  >
    <Combobox.Input
      id={inputId}
      placeholder="Party"
      autocomplete="off"
      oninput={(event) => (query = event.currentTarget.value)}
    />
    <Combobox.Content>
      {#each pickable as hit (hit.entityId)}
        <Combobox.Item value={hit.entityId} label={hit.displayName}>
          {hit.displayName}
          <span class="text-text-muted">&mdash; {searchHitKindLabel(hit.entityKind)}</span>
        </Combobox.Item>
      {/each}
    </Combobox.Content>
  </Combobox.Root>
{/key}

{#if searchFailed}
  <p class="text-xs text-text-muted">The Directory search could not be reached.</p>
{:else if capped}
  <p class="text-xs text-text-muted">
    The firm holds more matches than are listed. Narrowing the name brings the rest into reach.
  </p>
{:else if searching}
  <p class="text-xs text-text-muted">Searching the Directory.</p>
{/if}
