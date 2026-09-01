<script lang="ts">
  /*
   * The matters this record is a party to, and the hat it wears on each.
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
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import {
    readDirectoryEntityMatterParties,
    type DirectoryEntityMatterParty,
  } from "./directory-api.ts";

  let { entityId }: { entityId: string } = $props();

  let parties = $state<readonly DirectoryEntityMatterParty[] | null>(null);
  let nextCursor = $state<string | null>(null);
  let failure = $state<StatedFailure | null>(null);
  let loadingMore = $state(false);

  $effect(() => {
    const id = entityId;
    let cancelled = false;
    parties = null;
    nextCursor = null;
    failure = null;
    void (async () => {
      const outcome = await readDirectoryEntityMatterParties(fetch, id);
      if (cancelled) return;
      if (outcome.kind === "ok") {
        parties = outcome.value.data;
        nextCursor = outcome.value.nextCursor;
        return;
      }
      parties = [];
      failure = stated(outcome.failure, "The matters this record is on could not be read.");
    })();
    return () => {
      cancelled = true;
    };
  });

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
  <h3 class="text-sm font-semibold">Matters</h3>

  {#if failure !== null}
    <FailureNotice
      failure={failure.failure}
      title="The Matters Could Not Be Read"
      fallback={failure.fallback}
      whenSilent={failure.whenSilent}
    />
  {:else if parties === null}
    <div class="flex flex-col gap-8" aria-busy="true" aria-label="Reading the matters this record is on">
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
    </div>
  {:else if parties.length === 0}
    <EmptyState title="Not A Party To Anything Yet">
      This record is in the firm's book but is not linked to a matter. A record can exist purely to
      be matched against — a conflicts check searches every record, not only the ones on a file.
    </EmptyState>
  {:else}
    <DataTable.Root>
      <DataTable.Caption class="sr-only">
        The matters this record is a party to, and the hat it wears on each
      </DataTable.Caption>
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head>Matter</DataTable.Head>
          <DataTable.Head>Role</DataTable.Head>
          <DataTable.Head>Capacity</DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each parties as party (party.id)}
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
        {/each}
      </DataTable.Body>
    </DataTable.Root>

    {#if nextCursor !== null}
      <div>
        <Button variant="secondary" disabled={loadingMore} onclick={loadMore}>
          {loadingMore ? "Reading" : "Show more"}
        </Button>
      </div>
    {/if}
  {/if}
</section>
