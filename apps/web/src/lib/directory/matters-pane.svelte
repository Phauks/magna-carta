<script lang="ts">
  /*
   * Matters this record is a party to, and its role on each.
   *
   * AN ENTITY IS NOT A ROLE, and this pane is where that distinction is kept. The record is the
   * person or the organization; that they are the client on one matter, an opposing party on
   * another, and an executor on a third is a fact about those matters. So the roles are listed here
   * as a list rather than folded into the record's header as an attribute — a person shown as "the
   * client" is a person the firm will eventually be surprised by.
   *
   * CAPACITY IS RECORDED, NEVER INFERRED. A blank capacity means the firm wrote none down; nothing
   * derives one from the role, because a document that names a capacity has to name the one the firm
   * asserted.
   */
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { sampleMatter } from "@magna-carta/design-system/loading-fixtures";
  import {
    readDirectoryEntityMatterParties,
    type DirectoryEntityMatterParty,
  } from "./directory-api.ts";
  import { heldBackRows, visibleRows } from "./record-sections.ts";

  let { entityId }: { entityId: string } = $props();

  let parties = $state<readonly DirectoryEntityMatterParty[] | null>(null);
  let nextCursor = $state<string | null>(null);
  let readFailure = $state<StatedFailure | null>(null);
  let loadingMore = $state(false);
  let reloadToken = $state(0);
  /** True while a list already on screen is being read again. */
  let refreshing = $state(false);
  // The record whose matters last landed. Only a change of RECORD discards what is on screen: a
  // re-read of the same record keeps its rows where the reader is looking and marks the region
  // busy instead, and a read that failed left nothing worth keeping.
  let shownFor: string | null = null;

  /**
   * The shape the list takes while the record's matters are being read: the same rows the real
   * list renders, over the sample vocabulary. Not any file the firm holds.
   */
  const PARTY_FIXTURE: readonly DirectoryEntityMatterParty[] = [
    {
      id: "fixture-1",
      matterId: "fixture-matter-1",
      role: "Client",
      capacity: "Trustee",
      matterTitle: sampleMatter(1).title,
      matterNumber: sampleMatter(1).number,
      matterStatus: null,
      linkedAt: "",
    },
    {
      id: "fixture-2",
      matterId: "fixture-matter-2",
      role: "Opposing party",
      capacity: null,
      matterTitle: sampleMatter(3).title,
      matterNumber: sampleMatter(3).number,
      matterStatus: null,
      linkedAt: "",
    },
  ];

  $effect(() => {
    const id = entityId;
    void reloadToken;
    let cancelled = false;
    if (shownFor === id) {
      refreshing = true;
    } else {
      parties = null;
      nextCursor = null;
    }
    readFailure = null;
    void (async () => {
      const outcome = await readDirectoryEntityMatterParties(fetch, id);
      if (cancelled) return;
      refreshing = false;
      if (outcome.kind === "ok") {
        shownFor = id;
        parties = outcome.value.data;
        nextCursor = outcome.value.nextCursor;
        return;
      }
      shownFor = null;
      parties = [];
      readFailure = stated(outcome.failure, "Couldn't load this record's matters.");
    })();
    return () => {
      cancelled = true;
      refreshing = false;
    };
  });

  function retry(): void {
    reloadToken += 1;
  }

  let expanded = $state(false);
  const listedParties = $derived(visibleRows(parties ?? [], expanded));
  const heldBackParties = $derived(heldBackRows(parties ?? [], expanded));

  async function loadMore(): Promise<void> {
    const cursor = nextCursor;
    if (cursor === null || loadingMore) return;
    loadingMore = true;
    const outcome = await readDirectoryEntityMatterParties(fetch, entityId, cursor);
    loadingMore = false;
    if (outcome.kind !== "ok") return;
    parties = [...(parties ?? []), ...outcome.value.data];
    nextCursor = outcome.value.nextCursor;
  }
</script>

<section class="flex flex-col gap-16">
  <LoadingRegion
    loading={parties === null}
    {refreshing}
    failed={readFailure !== null}
    label="Reading the matters this record is on"
    onRetry={retry}
    class="flex flex-col gap-16"
  >
    {#snippet failure()}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure.failure}
          title="Couldn't Load Matters"
          fallback={readFailure.fallback}
          whenSilent={readFailure.whenSilent}
          onRetry={retry}
        />
      {/if}
    {/snippet}
    {#snippet fixture()}
      {@render partyTable(PARTY_FIXTURE)}
    {/snippet}

    {@render partyTable(listedParties)}

    {#if heldBackParties > 0}
      <!-- The record is one scrolling page, so a long list stops at its first few rows rather
           than pushing every section after it out of reach. -->
      <div>
        <Button variant="secondary" onclick={() => (expanded = true)}>
          Show All {(parties ?? []).length}{nextCursor === null ? "" : "+"}
        </Button>
      </div>
    {:else if nextCursor !== null}
      <div>
        <Button variant="secondary" disabled={loadingMore} onclick={loadMore}>
          {loadingMore ? "Reading" : "Show more"}
        </Button>
      </div>
    {/if}
  </LoadingRegion>
</section>

<!-- One table for the rows, for the shape they take while they are read, and for the empty body
     they leave behind when there are none, so the three cannot drift. -->
{#snippet partyTable(rows: readonly DirectoryEntityMatterParty[])}
  <DataTable.Root>
    <DataTable.Caption class="sr-only">
      Matters this record is a party to, and its role on each
    </DataTable.Caption>
    <DataTable.Header>
      <DataTable.Row>
        <DataTable.Head>Matter</DataTable.Head>
        <DataTable.Head>Role</DataTable.Head>
        <DataTable.Head>Capacity</DataTable.Head>
      </DataTable.Row>
    </DataTable.Header>
    <DataTable.Body>
      {#each rows as party (party.id)}
        <DataTable.Row>
          <DataTable.Cell>
            <span class="flex flex-col gap-4">
              {#if party.matterTitle === null}
                <span class="text-text-muted">—</span>
              {:else}
                <a class="underline underline-offset-2" href="/matters/{party.matterId}">
                  {party.matterTitle}
                </a>
              {/if}
              {#if party.matterNumber !== null}
                <span class="text-xs text-text-muted tabular-nums">{party.matterNumber}</span>
              {/if}
            </span>
          </DataTable.Cell>
          <DataTable.Cell>
            <Badge variant="neutral">{party.role}</Badge>
          </DataTable.Cell>
          <DataTable.Cell>
            {#if party.capacity === null || party.capacity === ""}
              <span class="text-text-muted">—</span>
            {:else}
              {party.capacity}
            {/if}
          </DataTable.Cell>
        </DataTable.Row>
      {:else}
        <DataTable.EmptyRow columns={3} title="Not A Party To Anything Yet" />
      {/each}
    </DataTable.Body>
  </DataTable.Root>
{/snippet}
