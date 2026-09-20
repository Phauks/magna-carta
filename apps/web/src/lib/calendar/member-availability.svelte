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
  import { entryFromTimelineRow, type CalendarEntry, type EntryContext } from "./calendar-entries.ts";
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
  }: {
    /** The people on the draft. Only the colleagues among them are asked about. */
    participants: readonly ParticipantDraft[];
    /** The day and hours being proposed. */
    timing: EventTimingDraft;
    /** What the projection needs to paint a row: the numbers, the type catalog, the reader's zone. */
    context: EntryContext;
  } = $props();

  const occurrence = $derived(proposedOccurrenceOf(timing));
  const colleagues = $derived(memberParticipantsOf(participants));

  /*
   * What each colleague's day holds, keyed by member and day, and filled only when a read comes
   * BACK. Which reads have been asked for is a separate, non-reactive set on purpose: a member
   * whose read is still in flight must not read as free, so "asked" and "answered" cannot be the
   * same fact.
   *
   * Keyed per member and per day, so adding a person asks about that person and moving the date
   * asks again about everybody — and neither re-asks about a pair already in hand.
   */
  let entriesByKey = $state<Record<string, readonly CalendarEntry[]>>({});
  const asked = new Set<string>();

  function keyOf(userId: string, date: string): string {
    return `${userId}@${date}`;
  }

  $effect(() => {
    const date = occurrence?.date;
    if (date === undefined) return;
    for (const colleague of colleagues) {
      const key = keyOf(colleague.userId, date);
      if (asked.has(key)) continue;
      asked.add(key);
      void readOneDay(colleague.userId, date, key);
    }
  });

  async function readOneDay(userId: string, date: string, key: string): Promise<void> {
    const outcome = await readFirmCalendar(fetch, {
      from: date,
      to: date,
      side: "all",
      memberId: userId,
    });
    // A read that failed leaves the line blank rather than claiming the colleague is free. The
    // form is not blocked on it either way: this is an answer to a question, not a gate.
    if (outcome.kind !== "ok") return;
    const entries = outcome.value.data.flatMap((row) => {
      const entry = entryFromTimelineRow(row, context);
      return entry === null ? [] : [entry];
    });
    entriesByKey[key] = entries;
  }

  const availability = $derived.by((): readonly MemberAvailability[] => {
    const proposed = occurrence;
    if (proposed === null) return [];
    return colleagues.map((colleague) => {
      const key = keyOf(colleague.userId, proposed.date);
      const entries = entriesByKey[key];
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
