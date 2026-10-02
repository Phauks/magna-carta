<script lang="ts">
  /*
   * The body of the Meetings screen: the three sections, or the one statement that stands instead of
   * them.
   *
   * IT IS A COMPONENT RATHER THAN THE PAGE ITSELF SO THAT THE READS STAY IN THE ROUTE. The page owns
   * the three questions it asks the server (`+page.ts` warms the first, the screen reads all three
   * through the one cache) and hands the answers here; this file owns what a reader sees, which is
   * everything a review is about and nothing a transport is needed to exercise. The screen's own
   * header stays on the page, where the back-navigation registry can see it.
   *
   * WHAT IS NOT TURNED ON IS SAID ONCE, NOT THREE TIMES. A deployment with no conferencing
   * credentials has no meetings to list, and three empty tables under three headings would tell a
   * reader their firm has no meetings when the truth is that the firm cannot hold one. The first
   * answer that arrives settles it, and the sections are not drawn at all.
   */
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import MeetingListSection from "./meeting-list-section.svelte";
  import {
    MEETING_SCOPES,
    type MeetingScope,
    type MeetingSectionState,
  } from "./meeting-list.ts";
  import type { MeetingSummary } from "@magna-carta/api-client";

  let {
    sections,
    configured = true,
    onAttendance,
  }: {
    /** The three scopes, each with what its own read came back with. */
    sections: Record<MeetingScope, MeetingSectionState>;
    /**
     * Whether this deployment carries meetings at all, as the first answer to arrive stated it.
     * True until something says otherwise, so a screen still reading does not flash a refusal.
     */
    configured?: boolean;
    /** Open the record of who was in an ended meeting, which the page holds. */
    onAttendance?: (meeting: MeetingSummary) => void;
  } = $props();
</script>

{#if configured}
  <div class="flex flex-col gap-24">
    {#each MEETING_SCOPES as scope (scope)}
      {@const state = sections[scope]}
      <MeetingListSection
        {scope}
        meetings={state.meetings}
        failure={state.failure ?? null}
        more={state.more ?? false}
        loadingMore={state.loadingMore ?? false}
        onRetry={state.onRetry}
        onLoadMore={state.onLoadMore}
        onAttendance={scope === "recent" ? onAttendance : undefined}
      />
    {/each}
  </div>
{:else}
  <EmptyState title="Meetings Are Not Turned On">
    Meetings have not been turned on for this firm, so there is nothing to list here and no room can
    be opened. An administrator is who puts that right.
    {#snippet actions()}
      <Button variant="secondary" href="/calendar">Go to the Calendar</Button>
    {/snippet}
  </EmptyState>
{/if}
