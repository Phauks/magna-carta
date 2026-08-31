<script lang="ts">
  /*
   * Who the money went to — the picker that turns a typed name into the Directory handle a cost
   * actually records.
   *
   * A COST DOES NOT TAKE A TYPED PAYEE. It takes a directory handle, which is what lets the firm
   * answer "how much have we advanced to this vendor across every matter" at all. A free-text box
   * would let the same court reporter be spelled four ways and none of those questions would have
   * an answer afterwards.
   *
   * The search behind it is the Directory's fuzzy trigram match, tolerant of typos, so a vendor
   * spelled a little differently still finds its record. A search that could not run says so rather
   * than rendering as an empty Directory: the two are the same picture and they are not the same
   * fact.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import { searchDirectory, type DirectorySearchHit } from "$lib/directory/directory-api.ts";
  import { searchHitKindLabel } from "$lib/directory/entity-presentation.ts";

  let {
    inputId,
    selectedName = null,
    disabled = false,
    onPick,
  }: {
    /** The combobox input's id, so the consumer's Label can point at it. */
    inputId: string;
    /** The payee already recorded, as its name reads. Null while none has been chosen. */
    selectedName?: string | null;
    disabled?: boolean;
    /** A payee was picked. Null clears it, which is a valid answer: the payee is optional. */
    onPick: (hit: DirectorySearchHit | null) => void;
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

  function pick(value: string | string[]): void {
    const entityId = Array.isArray(value) ? (value[0] ?? "") : value;
    if (entityId === "") {
      onPick(null);
      return;
    }
    const hit = results.find((candidate) => candidate.entityId === entityId);
    if (hit === undefined) return;
    onPick(hit);
    query = hit.displayName;
    settledQuery = hit.displayName;
  }
</script>

<Combobox.Root
  type="single"
  {disabled}
  items={results.map((hit) => ({ value: hit.entityId, label: hit.displayName }))}
  inputValue={query === "" ? (selectedName ?? "") : query}
  onValueChange={pick}
>
  <Combobox.Input
    id={inputId}
    fieldName="Payee"
    autocomplete="off"
    title="Who was paid, if anybody, from the firm's Directory. It is shared across matters, never matter-scoped."
    oninput={(event) => (query = event.currentTarget.value)}
  />
  <Combobox.Content>
    {#each results as hit (hit.entityId)}
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
