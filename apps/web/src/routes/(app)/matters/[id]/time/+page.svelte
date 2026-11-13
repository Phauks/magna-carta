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
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import { entryFromUrl } from "$lib/matters/entry-from-url.ts";
  import { listMatterTimeEntries, type TimeEntrySummary } from "$lib/matters/time-api.ts";
  import { readSession } from "$lib/matters/matters-api.ts";
  import { claimMatterCreate, SAMPLE_MATTER_REFUSAL } from "$lib/matters/create-action.svelte.ts";
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

  /*
   * The matter header's create control is this section's only create button: it answers the
   * press by opening the ledger's own record window (create-action.svelte.ts). The ledger is off
   * screen while a read has failed or on a sample matter, and the control says so instead of
   * pressing into nothing.
   */
  let ledger = $state<ReturnType<typeof TimeLedger> | null>(null);
  claimMatterCreate("time", () => ({
    title: "Record one entry on this matter. It saves as a draft.",
    refusal: isSample
      ? SAMPLE_MATTER_REFUSAL
      : ledger === null
        ? "The ledger is not on screen, so nothing can be recorded from it."
        : undefined,
    run: () => ledger?.openNew(),
  }));

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

<!-- The next page is asked for on the surface's line directly above the counts strip, and the
     line exists only while there is a next page: the surface draws the band whenever it is
     handed the snippet, so the page hands it over only then. -->
{#snippet beneath()}
  <div class="flex flex-col items-start gap-8">
    <Button variant="secondary" onclick={loadMore} disabled={list.loadingMore}>
      {list.loadingMore ? "Loading" : "Load more time"}
    </Button>
    <p class="text-xs text-text-muted">
      Showing the {(entries ?? []).length} most recent. The totals below cover only these until you load more.
    </p>
  </div>
{/snippet}

{#if loadFailure !== null}
  <!-- Through the standard failure surface. The Alert here interpolated the failure RECORD, so a
       reader got "[object Object]" ahead of the reassurance, and no Error ID to report. -->
  <section class="flex flex-col gap-16">
    <FailureNotice
      failure={loadFailure}
      title="Time Could Not Be Read"
      fallback="This matter's time could not be read."
      whenSilent="Couldn't connect while loading this matter's time."
      onRetry={() => (reloadToken += 1)}
    >
      The record itself is unaffected: nothing was changed by this failure.
    </FailureNotice>
  </section>
{:else if isSample}
  <section class="flex flex-col gap-16">
    <Alert.Root variant="info">
      <Alert.Title>This is a sample matter.</Alert.Title>
      <Alert.Description>
        This is a sample matter for previewing screens. It has no time. Open one of the firm's matters to use it.
      </Alert.Description>
    </Alert.Root>
  </section>
{:else}
  <!-- The ledger renders inside the money surface, which takes the rest of the screen and runs it
       to the edges: the table scrolls inside itself and the counts strip stays on the bottom, so
       the page does not grow taller as entries arrive. Load more sits on the surface's line
       directly above that strip, so the next page is asked for where the count is read. -->
  <TimeLedger
    bind:this={ledger}
    entries={entries ?? []}
    loading={entries === null}
    matterId={matter.id}
    matterTitle={matter.title}
    members={roster.members ?? []}
    {sessionUserId}
    openEntryId={entryFromUrl()}
    onChanged={() => (reloadToken += 1)}
    beneath={list.nextCursor !== null ? beneath : undefined}
  />
{/if}
