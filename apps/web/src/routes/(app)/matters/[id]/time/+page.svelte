<script lang="ts">
  /*
   * The matter's time — every entry recorded against it, read from the firm's own record.
   *
   * The whole record, not one slice of it: the listing is asked without a status, so approved,
   * billed and voided entries appear beside the drafts. Asking for the matter's time and being
   * shown only its drafts is how a matter looks emptier than it is.
   *
   * A SAMPLE matter (the in-repo fixtures the chrome's lifecycle states are reviewed against) has
   * no firm behind it and therefore no entries to read; it says so rather than showing an empty
   * table, because "no time recorded" and "not a real matter" are different facts.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import Play from "@lucide/svelte/icons/play";
  import {
    billableTotals,
    hoursFromMinutes,
    listMatterTimeEntries,
    statusLabel,
    statusTone,
    type TimeEntrySummary,
  } from "$lib/matters/time-api.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  let entries = $state<readonly TimeEntrySummary[] | null>(null);
  let loadFailure = $state<string | null>(null);

  $effect(() => {
    const matterId = matter.id;
    // The previous matter's answer is discarded before the next one is asked for. Left standing, a
    // failure is attributed to the matter now on screen and a table is read as that matter's own.
    entries = null;
    loadFailure = null;
    if (isSample) {
      entries = [];
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = await listMatterTimeEntries(fetch, matterId);
      if (cancelled) return;
      if (result.kind === "ok") {
        entries = result.value.data;
        loadFailure = null;
      } else if (result.kind === "transport") {
        entries = [];
        loadFailure = "Nothing answered. The time on this matter could not be read.";
      } else {
        entries = [];
        loadFailure = result.problem.detail ?? "The time on this matter could not be read.";
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  const totals = $derived(billableTotals(entries ?? []));

  function entryAmount(entry: TimeEntrySummary): string {
    // No charge is a statement, not a zero: a non-billable entry shows a dash rather than 0.00.
    if (!entry.billable || entry.amountMinor === null) return "—";
    return DataTable.formatMoney(entry.amountMinor / 100);
  }
</script>

<svelte:head>
  <title>Time · {matter.title} · Magna Carta</title>
</svelte:head>

<section class="flex flex-col gap-16">
  <div class="flex flex-col gap-8 border-b border-border-strong pb-8">
    <div class="flex items-center justify-between gap-16">
      <h2 class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
        Time
      </h2>
      <div class="flex items-center gap-8">
        <Badge variant="neutral">Soon</Badge>
        <Button variant="secondary" disabled>
          <Play aria-hidden="true" />
          Start timer
        </Button>
      </div>
    </div>
    <p class="text-xs text-text-muted">
      Starting and stopping a timer from this screen waits on the timer surface. Time already
      recorded on this matter is read here now, and the whole record is shown: drafts, approved,
      billed and voided alike.
    </p>
  </div>

  {#if loadFailure !== null}
    <Alert.Root variant="danger">
      <Alert.Title>Time Could Not Be Read</Alert.Title>
      <Alert.Description>{loadFailure}</Alert.Description>
    </Alert.Root>
  {:else if entries === null}
    <div class="flex flex-col gap-8" aria-busy="true" aria-label="Loading the matter's time">
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
    </div>
  {:else if isSample}
    <EmptyState title="No Time On A Sample Matter">
      This is one of the sample matters the interface is reviewed against. It has no firm behind it,
      so there is no time to read.
    </EmptyState>
  {:else if entries.length === 0}
    <EmptyState title="No Time Recorded Yet">
      Timers, manual entries and the weekly grid all land here, billable or not. Every entry keeps
      both the minutes worked and the minutes billed, so rounding is always visible.
    </EmptyState>
  {:else}
    <DataTable.Root>
      <DataTable.Caption class="sr-only">Time recorded on this matter</DataTable.Caption>
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head>Date</DataTable.Head>
          <DataTable.Head>Timekeeper</DataTable.Head>
          <DataTable.Head>Narrative</DataTable.Head>
          <DataTable.Head>Status</DataTable.Head>
          <DataTable.Head data-align="end">Hours</DataTable.Head>
          <DataTable.Head data-align="end">Amount</DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each entries as entry (entry.id)}
          <DataTable.Row>
            <DataTable.Cell>{DataTable.formatDate(entry.workDate)}</DataTable.Cell>
            <DataTable.Cell>
              {#if entry.timekeeperName === null || entry.timekeeperName === undefined}
                <span class="text-text-muted">No longer a member</span>
              {:else}
                {entry.timekeeperName}
              {/if}
            </DataTable.Cell>
            <DataTable.Cell>{entry.narrative}</DataTable.Cell>
            <DataTable.Cell>
              <Badge variant={statusTone(entry.status)}>{statusLabel(entry.status)}</Badge>
            </DataTable.Cell>
            <DataTable.Cell data-align="end">
              {hoursFromMinutes(entry.durationMinutes)}
            </DataTable.Cell>
            <DataTable.Cell data-align="end">{entryAmount(entry)}</DataTable.Cell>
          </DataTable.Row>
        {/each}
      </DataTable.Body>
    </DataTable.Root>

    <p class="text-xs text-text-muted">
      Billable time on this matter: {hoursFromMinutes(totals.minutes)} hours{#if totals.currency !== null},
        {DataTable.formatMoney(totals.amountMinor / 100)}{/if}. Voided entries are excluded, because
      a withdrawn line is not part of the total.
    </p>
  {/if}
</section>
