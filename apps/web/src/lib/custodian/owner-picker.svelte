<script lang="ts">
  /*
   * Whom the firm holds property for, picked from the Directory rather than typed.
   *
   * A PACKET CANNOT BE LOGGED FOR A NAME. The register stores directory handles, and that is the
   * whole reason it can answer "does this firm hold anything of Mrs Ableman's" eleven years after
   * her last matter closed. A free-text owner would let one client be three spellings, and every
   * one of those questions would stop having an answer.
   *
   * The search behind it is the Directory's own fuzzy match, tolerant of a typo and run over every
   * name an entity has ever held, so an original filed under a maiden name is still found under it.
   * A search that could not run says so rather than rendering as an empty Directory: the two are
   * the same picture and they are not the same fact.
   *
   * IT PICKS, AND FORGETS. The chosen entity is handed to the caller and the field clears itself,
   * because the form above it holds a LIST of owners and a field that kept the last pick would read
   * as though that pick were still pending.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import { searchDirectory, type DirectorySearchHit } from "$lib/directory/directory-api.ts";
  import { searchHitKindLabel } from "$lib/directory/entity-presentation.ts";

  let {
    inputId,
    fieldName,
    disabled = false,
    excluded = [],
    onPick,
  }: {
    /** The combobox input's id, so the consumer's Label can point at it. */
    inputId: string;
    /** What this field is choosing, for the input's own accessible name. */
    fieldName: string;
    disabled?: boolean;
    /** Handles already chosen. Offering one twice would invite a duplicate the server refuses. */
    excluded?: readonly string[];
    /** An entity was chosen. */
    onPick: (hit: DirectorySearchHit) => void;
  } = $props();

  let query = $state("");
  let settledQuery = $state("");
  let results = $state<readonly DirectorySearchHit[]>([]);
  let capped = $state(false);
  let searching = $state(false);
  let searchFailed = $state(false);

  // The typed query settles before it is sent: a Directory search per keystroke is a request per
  // keystroke, and the firm's own record is the authoritative match rather than the rows on screen.
  const SETTLE_MILLISECONDS = 250;
  $effect(() => {
    const typed = query;
    const timer = setTimeout(() => (settledQuery = typed), SETTLE_MILLISECONDS);
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
      results = [];
      capped = false;
      searchFailed = true;
    })();
    return () => {
      live = false;
    };
  });

  const offered = $derived(results.filter((hit) => !excluded.includes(hit.entityId)));

  function pick(value: string | string[]): void {
    const entityId = Array.isArray(value) ? (value[0] ?? "") : value;
    const hit = offered.find((candidate) => candidate.entityId === entityId);
    if (hit === undefined) return;
    onPick(hit);
    query = "";
    settledQuery = "";
    results = [];
  }
</script>

<Combobox.Root
  type="single"
  {disabled}
  items={offered.map((hit) => ({ value: hit.entityId, label: hit.displayName }))}
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
    {#each offered as hit (hit.entityId)}
      <Combobox.Item value={hit.entityId} label={hit.displayName}>
        {hit.displayName}
        <span class="text-text-muted">&mdash; {searchHitKindLabel(hit.entityKind)}</span>
      </Combobox.Item>
    {/each}
  </Combobox.Content>
</Combobox.Root>

{#if searchFailed}
  <p class="text-xs text-text-muted">The Directory search could not be reached.</p>
{:else if capped}
  <p class="text-xs text-text-muted">
    The firm holds more matches than are listed. Narrowing the name brings the rest into reach.
  </p>
{:else if searching}
  <p class="text-xs text-text-muted">Searching the Directory.</p>
{/if}
