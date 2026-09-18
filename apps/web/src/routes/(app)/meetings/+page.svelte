<script lang="ts">
  /*
   * Meetings — what is running, what is coming, and what has just finished.
   *
   * WHY THE SCREEN EXISTS AT ALL, when every meeting is started from its own calendar entry. Two
   * questions the calendar cannot answer without being searched: is anything running right now, and
   * what have I just missed. A member who knows there is a meeting and does not remember which
   * hearing it hangs on would otherwise have to find the entry first, which is a search for
   * something they can see the whole of on one screen.
   *
   * THREE READS, NOT ONE. Each section is its own scope on the server — the rooms in progress, the
   * meetings on events from the reader's own day onward, and the last thirty days of endings — and
   * each is paged on its own, because they grow at completely different rates. The reads are fired
   * from the cache rather than awaited, so the screen draws its shape immediately; `+page.ts` says
   * why only the first is warmed.
   *
   * THE READER'S OWN DAY IS THE READER'S. The upcoming scope is measured from a civil date, and the
   * server has no zone to derive one in, so the browser states its own — through the calendar's
   * helper, which resolves the zone once and falls back to UTC where a runtime cannot say.
   */
  import { createInfiniteQuery } from "@tanstack/svelte-query";
  import { meetingsListInfiniteOptions } from "@magna-carta/api-client";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { failureOf } from "$lib/api/api-client.ts";
  import { paged } from "$lib/api/screen-data.ts";
  import { todayCivil } from "$lib/calendar/calendar-window.ts";
  import MeetingsScreen from "$lib/meetings/meetings-screen.svelte";
  import type { MeetingScope, MeetingSectionState } from "$lib/meetings/meeting-list.ts";
  import type { MeetingSummary } from "@magna-carta/api-client";

  /*
   * Read once, at mount. The reader's day is what the upcoming scope is measured from, and a value
   * that re-derived itself would change the query key at midnight under somebody looking at the
   * screen — which reads as the list emptying itself for no reason.
   */
  const today = todayCivil();

  const live = createInfiniteQuery(() =>
    paged(meetingsListInfiniteOptions({ query: { scope: "live" } })),
  );
  const upcoming = createInfiniteQuery(() =>
    paged(meetingsListInfiniteOptions({ query: { scope: "upcoming", today } })),
  );
  const recent = createInfiniteQuery(() =>
    paged(meetingsListInfiniteOptions({ query: { scope: "recent" } })),
  );

  type MeetingsRead = typeof live;

  /** Every page in hand, as one listing. Null while nothing has arrived, which is not an empty list. */
  function meetingsOf(read: MeetingsRead): readonly MeetingSummary[] | null {
    const pages = read.data?.pages;
    if (pages === undefined) return null;
    return pages.flatMap((page) => page.data);
  }

  /** What one section's table renders from: its rows, its refusal, and its way to the next page. */
  function sectionOf(read: MeetingsRead): MeetingSectionState {
    return {
      meetings: read.isError ? null : meetingsOf(read),
      failure: read.isError ? failureOf(read.error) : null,
      more: read.hasNextPage,
      loadingMore: read.isFetchingNextPage,
      onRetry: () => void read.refetch(),
      onLoadMore: () => void read.fetchNextPage(),
    };
  }

  const sections = $derived<Record<MeetingScope, MeetingSectionState>>({
    live: sectionOf(live),
    upcoming: sectionOf(upcoming),
    recent: sectionOf(recent),
  });

  /*
   * Whether this deployment carries meetings at all, as the summaries themselves state it: the flag
   * rides on every meeting the server hands back. Nothing in hand says nothing either way, so the
   * screen assumes yes and shows its three sections — a firm with meetings turned on and none in any
   * scope has an empty list, which is a different fact from a firm that cannot hold one.
   */
  const configured = $derived(
    [sections.live, sections.upcoming, sections.recent]
      .flatMap((section) => section.meetings ?? [])
      .every((meeting) => meeting.configured),
  );
</script>

<svelte:head><title>Meetings · Magna Carta</title></svelte:head>

<div class="flex flex-col gap-24">
  <ScreenHeader title="Meetings" />
  <MeetingsScreen {sections} {configured} />
</div>
