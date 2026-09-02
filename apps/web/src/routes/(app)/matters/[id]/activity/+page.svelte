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
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import { listMatterActivity, type ActivityEntry } from "$lib/matters/activity-api.ts";
  import { ActivityDetails } from "$lib/matters/activity-detail.svelte.ts";
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
  // What each row's own subsystem says about it, read once per matter through that subsystem's own
  // access gate. A source with no loader renders exactly as it did.
  const details = new ActivityDetails();

  const entries = $derived(list.items);
  const failure = $derived(list.failure);

  // Which bands are showing. Empty means every band, which is the resting state: the question this
  // screen answers first is "what happened", not "what happened in one subsystem".
  let chosenBands = $state<readonly ActivityBandKey[]>([]);
  // Bumped to re-read after a failure; every filter is part of the subject, so changing one re-reads
  // on its own.
  let reloadToken = $state(0);
  // Which half of the case. "All" is the resting state, because what has happened and what is coming
  // are one list read in one order — a deadline next Tuesday belongs beside the hearing it came from.
  let direction = $state<"all" | "past" | "future">("all");
  let fromDate = $state("");
  let toDate = $state("");

  const chosenSourceKeys = $derived(
    chosenBands.flatMap((band) => sourcesInBand(band).map((presentation) => presentation.key)),
  );

  /*
   * The activity read, and nothing else in this effect. A screen whose only subject is one read must
   * not let anything else stand between the subject changing and the read being asked for.
   */
  /** Everything narrowing the read, as the server takes it. The subject the list is keyed on. */
  const query = $derived({
    ...(chosenSourceKeys.length === 0 ? {} : { sourceKeys: chosenSourceKeys }),
    ...(fromDate === "" ? {} : { from: fromDate }),
    ...(toDate === "" ? {} : { to: toDate }),
    ...(direction === "all" ? {} : { direction }),
  });

  $effect(() => {
    const matterId = matter.id;
    const asked = query;
    const subject = `${matterId}:${String(reloadToken)}:${JSON.stringify(asked)}`;
    if (list.showing(subject)) return;
    list.reset(subject);
    if (isSample) {
      list.settleEmpty();
      return;
    }
    void list.load((cursor) => listMatterActivity(fetch, matterId, cursor, asked));
  });

  // The roster resolves an actor into a person. Its own effect: a firm whose member list cannot be
  // read still gets its activity, with the actor column saying so rather than the page failing.
  $effect(() => {
    if (isSample) return;
    void roster.load(fetch);
  });

  /*
   * The detail behind the rows, read once per matter and kept across pages. Its own effect for the
   * same reason the roster has one: a subsystem that will not answer costs its rows their extra
   * line, never the chronology.
   */
  $effect(() => {
    const matterId = matter.id;
    if (isSample || details.showing(matterId)) return;
    details.reset(matterId);
    void details.load(fetch, matterId);
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
    const asked = query;
    void list.loadMore((cursor) => listMatterActivity(fetch, matter.id, cursor, asked));
  }

  function clearFilters(): void {
    chosenBands = [];
    direction = "all";
    fromDate = "";
    toDate = "";
  }

  /** Whether anything is narrowing the list, which is what the Clear control's presence answers. */
  const narrowed = $derived(
    chosenBands.length > 0 || direction !== "all" || fromDate !== "" || toDate !== "",
  );
</script>

<svelte:head>
  <title>Activity · {matter.title} · Magna Carta</title>
</svelte:head>

<section class="flex min-h-0 flex-1 flex-col gap-16">
  <div class="flex flex-col gap-8 border-b border-border-strong pb-12">
    <div class="flex flex-wrap items-center gap-8">
      <h2 class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
        Activity
      </h2>
      <!--
        Bands, not sources: a reader thinks "show me the money", not "show me costEntry". ALL leads
        the row and is pressed whenever nothing else is, so the resting state is a state somebody
        chose rather than an absence they have to infer — and every other band is a toggle, so any
        number of them can be on at once.
      -->
      <div class="flex flex-wrap items-center gap-4" role="group" aria-label="Kinds of activity">
        <Button
          variant={chosenBands.length === 0 ? "secondary" : "ghost"}
          size="sm"
          disabled={isSample}
          aria-pressed={chosenBands.length === 0}
          onclick={() => (chosenBands = [])}
        >
          All
        </Button>
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
      </div>
    </div>

    <div class="flex flex-wrap items-end gap-12">
      <!-- What has happened and what is coming are one list by default; these split it. -->
      <div class="flex items-center gap-4" role="group" aria-label="When">
        {#each [{ key: "all", label: "Any time" }, { key: "past", label: "Past" }, { key: "future", label: "Upcoming" }] as const as choice (choice.key)}
          <Button
            variant={direction === choice.key ? "secondary" : "ghost"}
            size="sm"
            disabled={isSample}
            aria-pressed={direction === choice.key}
            onclick={() => (direction = choice.key)}
          >
            {choice.label}
          </Button>
        {/each}
      </div>
      <div class="flex flex-col gap-4">
        <Label for="activity-from">From</Label>
        <Input id="activity-from" type="date" disabled={isSample} bind:value={fromDate} />
      </div>
      <div class="flex flex-col gap-4">
        <Label for="activity-to">To</Label>
        <Input id="activity-to" type="date" disabled={isSample} bind:value={toDate} />
      </div>
      {#if narrowed}
        <!-- Present only while something is narrowing the list, so its absence answers "is anything
             hidden". -->
        <Button variant="ghost" size="sm" onclick={clearFilters}>Clear Filters</Button>
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
    {:else if entries.length === 0 && narrowed}
      <EmptyState title="Nothing on this matter matches those filters." />
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
              {@const detail = details.detailFor(entry.sourceKey, entry.rowId)}
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
                {#if detail === undefined}
                  <span class="text-sm">{happenedText(entry.sourceKey)}</span>
                {:else}
                  <!-- Where its own subsystem can name the row, the NAME leads and the kind drops to
                       one quiet word: a reader scanning for a document is scanning for what it is
                       called, and "A document was added to the matter" on forty rows is forty
                       repetitions of what the glyph already said. The whole sentence is still what
                       a row with no name to lead with shows, because there it carries the row. -->
                  <span class="text-sm">{detail.title}</span>
                  <span class="text-xs text-text-muted">
                    {presentation?.noun ?? happenedText(entry.sourceKey)}
                  </span>
                  {#if detail.secondary !== undefined && detail.secondary !== ""}
                    <span class="text-xs text-text-muted">{detail.secondary}</span>
                  {/if}
                {/if}
                {#if entry.label !== null}
                  <!-- Named, because a label is a specific field and never a title: a document's
                       TYPE beside a document row reads as its name unless it says which. -->
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
