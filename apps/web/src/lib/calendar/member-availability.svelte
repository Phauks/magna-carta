<script lang="ts">
  /*
   * Who among the colleagues on this setting is already busy at the hour it proposes.
   *
   * ONE READ PER COLLEAGUE, FOR ONE DAY, and only while the form is open. It is the member filter
   * the server already resolves in SQL — the same read the rail's member calendars make — so this
   * adds no contract and no second notion of what "on somebody's calendar" means.
   *
   * A READ IS NOT A REFUSAL. Nothing here blocks a commit: double-booking is routinely correct and
   * the platform does not referee it. What it does is put the answer where the question is asked,
   * beside the people on the Who tab, rather than leaving a member to read it off a day schedule
   * that shows whichever calendars they happen to have turned on.
   *
   * WHAT IT PRINTS IS NEVER A TITLE — member-availability.ts states why at length.
   */
  import { readFirmCalendar } from "./calendar-api.ts";
  import { AvailabilityReads } from "./availability-reads.svelte.ts";
  import {
    availabilityEntryFromTimelineRow,
    type CalendarEntry,
    type EntryContext,
  } from "./calendar-entries.ts";
  import {
    availabilitySentence,
    busyLabels,
    memberParticipantsOf,
    proposedOccurrenceOf,
    type MemberAvailability,
  } from "./member-availability.ts";
  import type { EventTimingDraft, ParticipantDraft } from "./event-draft.ts";

  let {
    participants,
    timing,
    context,
    open = true,
  }: {
    /** The people on the draft. Only the colleagues among them are asked about. */
    participants: readonly ParticipantDraft[];
    /** The day and hours being proposed. */
    timing: EventTimingDraft;
    /** What the projection needs to paint a row: the numbers, the type catalog, the reader's zone. */
    context: EntryContext;
    /**
     * Whether the form asking is open. Nothing read here survives it closing: availability is a
     * claim about a particular hour of a particular day, and a form reopened later is a fresh
     * question — the day may have filled up since, and the read that failed may now succeed.
     */
    open?: boolean;
  } = $props();

  const occurrence = $derived(proposedOccurrenceOf(timing));
  const colleagues = $derived(memberParticipantsOf(participants));

  /**
   * What has been asked about and what came back. The bookkeeping is
   * `availability-reads.svelte.ts` — "asked" and "answered" are separate facts there, a read that
   * failed is asked again, and a closed form is forgotten.
   */
  const reads = new AvailabilityReads();

  $effect(() => {
    reads.refresh(open, colleagues, occurrence?.date ?? null, readOneDay);
  });

  async function readOneDay(
    userId: string,
    date: string,
  ): Promise<readonly CalendarEntry[] | null> {
    const outcome = await readFirmCalendar(fetch, {
      from: date,
      to: date,
      side: "all",
      memberId: userId,
    });
    // Null rather than an empty day: a read that did not come back must not claim the colleague is
    // free, and it is the answer that gets asked again.
    if (outcome.kind !== "ok") return null;
    return outcome.value.data.flatMap((row) => {
      const entry = availabilityEntryFromTimelineRow(row, context);
      return entry === null ? [] : [entry];
    });
  }

  const availability = $derived.by((): readonly MemberAvailability[] => {
    const proposed = occurrence;
    if (proposed === null) return [];
    return colleagues.map((colleague) => {
      const entries = reads.entriesFor(colleague.userId, proposed.date);
      return {
        userId: colleague.userId,
        displayName: colleague.displayName,
        busy: entries === undefined ? [] : busyLabels(entries, proposed),
        read: entries !== undefined,
      };
    });
  });
</script>

{#if availability.length > 0}
  <div class="flex flex-col gap-4">
    <p class="text-sm text-text-muted">Who is already busy then</p>
    <ul class="flex flex-col gap-4">
      {#each availability as member (member.userId)}
        <li class="flex flex-wrap items-baseline gap-8 text-sm">
          <span class="text-text">{member.displayName}</span>
          {#if availabilitySentence(member) !== null}
            <span class="text-text-muted">{availabilitySentence(member)}</span>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}
