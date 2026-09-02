<script lang="ts">
  /*
   * The matter's activity: what has happened on this case, in order, from every part of the platform
   * that records anything.
   *
   * ONE READ, FOURTEEN SUBSYSTEMS, AND NO SECOND TIMELINE TABLE. The server federates each declared
   * source in place — mail filed, documents filed and assembled, events, deadlines, time, costs,
   * client money, items in custody, conflicts checks, notes, and the matter's own opening and
   * closing — under one sort key and one cursor. Nothing is copied into an activity table, so this
   * screen cannot disagree with the register behind it, and a subsystem joining the timeline reaches
   * this page without a line of work here.
   *
   * THE ROWS ARE DELIBERATELY THIN, AND THAT IS THE CONFIDENTIALITY DESIGN. Most sources declare no
   * label at all: a note's first eight words and an email's subject line are exactly the disclosure
   * a read spanning a whole matter must not make. So a row says what happened, when, and by whom,
   * and the words are behind the link, one authenticated request into the subsystem that owns them.
   * A row that looks sparse here is a row keeping its content where its own access gate is.
   *
   * ADDING A SOURCE IS ONE ENTRY IN activity-presentation.ts, and a test fails until it exists —
   * this file names no source and switches on none.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import { formatDate } from "@magna-carta/design-system/data-table";
  import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import { listMatterActivity, type ActivityEntry } from "$lib/matters/activity-api.ts";
  import { activityDays, timeOfDay } from "$lib/matters/activity-days.ts";
  import {
    ACTIVITY_BANDS,
    followableLink,
    happenedText,
    presentationFor,
    sourcesInBand,
    type ActivityBandKey,
  } from "$lib/matters/activity-presentation.ts";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import { FirmRoster } from "$lib/members/firm-roster.svelte.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  const list = new PagedList<ActivityEntry>("This matter's activity could not be read.");
  const roster = new FirmRoster();

  const entries = $derived(list.items);
  const failure = $derived(list.failure);

  // Which bands are showing. Empty means every band, which is the resting state: the question this
  // screen answers first is "what happened", not "what happened in one subsystem".
  let chosenBands = $state<readonly ActivityBandKey[]>([]);
  // Bumped to re-read after a failure; the filter is part of the subject, so changing it re-reads
  // on its own.
  let reloadToken = $state(0);

  const chosenSourceKeys = $derived(
    chosenBands.flatMap((band) => sourcesInBand(band).map((presentation) => presentation.key)),
  );

  /*
   * The activity read, and nothing else in this effect. A screen whose only subject is one read must
   * not let anything else stand between the subject changing and the read being asked for.
   */
  $effect(() => {
    const matterId = matter.id;
    const sourceKeys = chosenSourceKeys;
    const subject = `${matterId}:${String(reloadToken)}:${sourceKeys.join(",")}`;
    if (list.showing(subject)) return;
    list.reset(subject);
    if (isSample) {
      list.settleEmpty();
      return;
    }
    void list.load((cursor) =>
      listMatterActivity(fetch, matterId, cursor, (sourceKeys.length === 0 ? {} : { sourceKeys })),
    );
  });

  // The roster resolves an actor into a person. Its own effect: a firm whose member list cannot be
  // read still gets its activity, with the actor column saying so rather than the page failing.
  $effect(() => {
    if (isSample) return;
    void roster.load(fetch);
  });

  const days = $derived(activityDays(entries ?? []));

  function actorName(userId: string | null): string | null {
    if (userId === null) return null;
    const member = (roster.members ?? []).find((candidate) => candidate.userId === userId);
    return member?.displayName ?? null;
  }

  function toggleBand(band: ActivityBandKey, on: boolean): void {
    chosenBands = on
      ? [...chosenBands, band]
      : chosenBands.filter((candidate) => candidate !== band);
  }

  function loadMore(): void {
    const sourceKeys = chosenSourceKeys;
    void list.loadMore((cursor) =>
      listMatterActivity(fetch, matter.id, cursor, (sourceKeys.length === 0 ? {} : { sourceKeys })),
    );
  }
</script>

<svelte:head>
  <title>Activity · {matter.title} · Magna Carta</title>
</svelte:head>

<section class="flex min-h-0 flex-1 flex-col gap-16">
  <div class="flex flex-wrap items-center gap-16 border-b border-border-strong pb-8">
    <h2 class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
      Activity
    </h2>
    <!-- Bands, not sources: a reader thinks "show me the money", not "show me costEntry". Nothing
         pressed means everything, so the resting state needs no explaining. -->
    <div class="flex flex-wrap items-center gap-4" role="group" aria-label="Narrow the activity">
      {#each ACTIVITY_BANDS as band (band.key)}
        {@const on = chosenBands.includes(band.key)}
        <Button
          variant={on ? "secondary" : "ghost"}
          size="sm"
          disabled={isSample}
          aria-pressed={on}
          onclick={() => toggleBand(band.key, !on)}
        >
          {band.label}
        </Button>
      {/each}
      {#if chosenBands.length > 0}
        <Button variant="ghost" size="sm" onclick={() => (chosenBands = [])}>
          Show Everything
        </Button>
      {/if}
    </div>
  </div>

  {#if failure !== null}
    <Alert.Root variant="danger">
      <Alert.Title>Activity Unavailable</Alert.Title>
      <Alert.Description>
        {failure} The record itself is unaffected: nothing was changed by this failure.
      </Alert.Description>
    </Alert.Root>
    <Button class="self-start" variant="secondary" onclick={() => (reloadToken += 1)}>Retry</Button>
  {/if}

  <div class="flex min-h-0 flex-1 flex-col gap-16">
    {#if isSample}
      <EmptyState title="This is a sample matter, so nothing has happened on it." />
    {:else if entries === null}
      <Skeleton class="h-24 w-full" />
      <Skeleton class="h-24 w-full" />
      <Skeleton class="h-24 w-full" />
    {:else if entries.length === 0 && chosenBands.length > 0}
      <EmptyState title="Nothing of that kind has been recorded on this matter." />
    {:else if entries.length === 0}
      <EmptyState title="Nothing has been recorded on this matter yet." />
    {:else}
      {#each days as day (day.day)}
        <div class="flex flex-col gap-8">
          <h3
            class="text-xs text-text-muted uppercase"
            style="letter-spacing: var(--mc-tracking-caps)"
          >
            {formatDate(day.day)}
          </h3>
          <!--
            A chronology is read down a column, so the rows are LINES rather than cards: a border
            around each one turns twenty entries into twenty objects to look at, and the day is
            already the thing that groups them. One hairline between rows is all the separation a
            list in date order needs.
          -->
          <ul class="flex flex-col">
            {#each day.entries as entry (entry.sourceKey + entry.rowId)}
              {@const presentation = presentationFor(entry.sourceKey)}
              {@const href = followableLink(entry.sourceKey, entry.link)}
              {@const who = actorName(entry.actorUserId)}
              {@const at = timeOfDay(entry.sortKey)}
              <li
                class="flex flex-wrap items-center gap-8 border-b border-border-default py-8 last:border-b-0"
              >
                <!-- The time column is fixed-width and empty on a source that records only a day,
                     so the sentences stay aligned down the page rather than stepping in and out. -->
                <span class="w-96 shrink-0 text-xs whitespace-nowrap tabular-nums text-text-muted">
                  {at ?? ""}
                </span>
                {#if presentation !== undefined}
                  {@const Glyph = presentation.icon}
                  <Glyph aria-hidden="true" class="size-16 shrink-0 text-text-muted" />
                {/if}
                <span class="text-sm">{happenedText(entry.sourceKey)}</span>
                {#if entry.label !== null}
                  <!-- Named, because a label is a specific field and never a title: a document's
                       TYPE beside "A document was filed" reads as its name unless it says which. -->
                  <span class="text-xs text-text-muted">
                    {presentation?.labelMeaning ?? "Recorded"}: {entry.label}
                  </span>
                {/if}
                {#if who !== null}
                  <span class="text-xs text-text-muted">by {who}</span>
                {/if}
                {#if href !== null}
                  <a
                    {href}
                    class="ml-auto flex shrink-0 items-center gap-4 text-xs text-text-muted underline"
                  >
                    Open
                    <ArrowUpRight aria-hidden="true" class="size-12" />
                  </a>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/each}

      {#if list.nextCursor !== null}
        <div class="flex justify-center">
          <Button variant="secondary" disabled={list.loadingMore} onclick={loadMore}>
            {list.loadingMore ? "Loading" : "Load More"}
          </Button>
        </div>
      {/if}
    {/if}
  </div>
</section>
