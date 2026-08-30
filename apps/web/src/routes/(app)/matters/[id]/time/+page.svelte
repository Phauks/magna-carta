<script lang="ts">
  /*
   * The matter's time — every entry recorded against it, read from the firm's own record.
   *
   * The whole record, not one slice of it: the listing is asked without a status, so approved,
   * billed and voided entries appear beside the drafts. Asking for the matter's time and being shown
   * only its drafts is how a matter looks emptier than it is.
   *
   * This page is the read and the state set; the ledger itself is the surface below it. A SAMPLE
   * matter (the in-repo fixtures the chrome's lifecycle states are reviewed against) has no firm
   * behind it and therefore no entries to read; it says so rather than showing an empty table,
   * because "no time recorded" and "not a real matter" are different facts.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import { listMatterTimeEntries, type TimeEntrySummary } from "$lib/matters/time-api.ts";
  import { readSession } from "$lib/matters/matters-api.ts";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import { FirmRoster } from "$lib/members/firm-roster.svelte.ts";
  import TimeLedger from "$lib/time/time-ledger.svelte";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  const list = new PagedList<TimeEntrySummary>("The time on this matter could not be read.");
  const entries = $derived(list.items);
  const loadFailure = $derived(list.failure);

  const roster = new FirmRoster();
  let sessionUserId = $state<string | null>(null);
  // Bumped after a write, so the ledger re-reads what the server now holds rather than guessing.
  let reloadToken = $state(0);

  $effect(() => {
    void roster.load(fetch);
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") sessionUserId = outcome.value.user.id;
    })();
  });

  $effect(() => {
    const matterId = matter.id;
    const token = reloadToken;
    if (list.showing(`${matterId}:${String(token)}`)) return;
    list.reset(`${matterId}:${String(token)}`);
    if (isSample) {
      list.settleEmpty();
      return;
    }
    void list.load((cursor) => listMatterTimeEntries(fetch, matterId, cursor));
  });

  function loadMore(): void {
    void list.loadMore((cursor) => listMatterTimeEntries(fetch, matter.id, cursor));
  }
</script>

<svelte:head>
  <title>Time · {matter.title} · Magna Carta</title>
</svelte:head>

{#if loadFailure !== null}
  <section class="flex flex-col gap-16">
    <Alert.Root variant="danger">
      <Alert.Title>Time Could Not Be Read</Alert.Title>
      <Alert.Description>
        {loadFailure} The record itself is unaffected: nothing was changed by this failure.
      </Alert.Description>
    </Alert.Root>
    <Button class="self-start" variant="secondary" onclick={() => (reloadToken += 1)}>Retry</Button>
  </section>
{:else if isSample}
  <section class="flex flex-col gap-16">
    <Alert.Root variant="info">
      <Alert.Title>This is a sample matter.</Alert.Title>
      <Alert.Description>
        It exists so the matter screens stay reviewable at a stable address; there is no firm record
        behind it, so it holds no time and nothing can be recorded against it. Open one of the firm's
        own matters to use this surface.
      </Alert.Description>
    </Alert.Root>
  </section>
{:else}
  <TimeLedger
    entries={entries ?? []}
    loading={entries === null}
    matterId={matter.id}
    matterTitle={matter.title}
    members={roster.members ?? []}
    {sessionUserId}
    onChanged={() => (reloadToken += 1)}
  />
  {#if list.nextCursor !== null}
    <div class="mt-12 flex flex-col items-start gap-8">
      <Button variant="secondary" onclick={loadMore} disabled={list.loadingMore}>
        {list.loadingMore ? "Loading" : "Load more time"}
      </Button>
      <p class="text-xs text-text-muted">
        Showing the {(entries ?? []).length} most recent. The figures below cover only what is loaded,
        so they are not the matter's whole time record until every page is read.
      </p>
    </div>
  {/if}
{/if}
