<script lang="ts">
  /*
   * Start meeting, or join the one already running — on the event's own record window.
   *
   * IT LIVES ON THE EVENT, NOT ON THE CALENDAR. A meeting hangs off exactly one calendar entry and
   * carries no title or time of its own, so the place to open one is the place the entry is read.
   * One control on the one window serves the matter calendar, the firm calendar and the firm-events
   * list at once, which is also why none of those three had to be restyled to get it.
   *
   * IT RENDERS NOTHING RATHER THAN RENDERING REFUSED, and that is the deliberate exception to the
   * standing rule that a designed-but-unavailable control stays visible saying why. That rule is
   * about a capability this product HAS: a control that vanishes leaves a reader wondering whether
   * they missed it. A deployment with no conferencing credentials has no such capability — there is
   * nothing for the member to be refused FROM and nothing anybody here can turn on — and a
   * permanently disabled button on every entry in the calendar is chrome that never becomes
   * anything. The same holds for a member who may join but not host, on an entry with no meeting:
   * there is nothing to join yet and nothing they could start. And for a member who may not join
   * meetings at all: the control has nothing to offer them, so it neither renders NOR asks the
   * server — the entry's meeting is read behind that same permission, and asking anyway bought them
   * a refusal on every entry window they opened.
   */
  import Lock from "@lucide/svelte/icons/lock";
  import UsersRound from "@lucide/svelte/icons/users-round";
  import Phone from "@lucide/svelte/icons/phone";
  import Video from "@lucide/svelte/icons/video";
  import Button from "@magna-carta/design-system/button";
  import Label from "@magna-carta/design-system/label";
  import Switch from "@magna-carta/design-system/switch";
  import { createQuery } from "@tanstack/svelte-query";
  import {
    meetingsGetForEventOptions,
    meetingsGetForFirmEventOptions,
  } from "@magna-carta/api-client";
  import { goto } from "$app/navigation";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import { MEETING_LOBBY_LABEL } from "$lib/calendar/event-draft.ts";
  import { startMeeting } from "./meetings-api.ts";
  import MeetingGuestsPanel from "./meeting-guests-panel.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import type { MeetingMedium } from "./meeting-client.svelte.ts";

  let {
    eventKind,
    eventId,
    startable = true,
  }: {
    /** Which side of the calendar this entry is on. A deadline has no meeting and renders none. */
    eventKind: "matter" | "firm";
    /** The matter event's or firm event's own identifier. */
    eventId: string;
    /**
     * Whether a meeting may be opened on this entry at all. False for a setting that has been
     * cancelled: the entry stays on the record, and opening a room on it would say it is happening.
     * A meeting already running on such an entry is still joinable, because people are in it.
     */
    startable?: boolean;
  } = $props();

  $effect(() => {
    void sessionPermissions.load(fetch);
  });

  const canHost = $derived(sessionPermissions.holds("meetings:host"));
  /*
   * Whether this member may be in a meeting at all — and therefore whether the entry's meeting is
   * read at all. The read is behind `meetings:join`, so a member without it was being refused once
   * per entry they opened: a 403 on every window, on a control that would then render nothing
   * anyway. It also errs the right way while the session is still being read, because `holds`
   * answers false until it lands.
   */
  const canJoin = $derived(sessionPermissions.holds("meetings:join"));

  /*
   * The entry's meeting, or a 404 saying it has none. The 404 is the ordinary answer rather than a
   * fault — most entries never have a meeting — so it is read as "there is none to join" and this
   * control says nothing about it.
   */
  const matterEventRead = createQuery(() => ({
    ...meetingsGetForEventOptions({ path: { eventId } }),
    enabled: canJoin && eventKind === "matter",
  }));
  const firmEventRead = createQuery(() => ({
    ...meetingsGetForFirmEventOptions({ path: { firmEventId: eventId } }),
    enabled: canJoin && eventKind === "firm",
  }));
  // Two reads rather than one over a ternary: the two operations have different path shapes, so a
  // single accessor returning either is a type the query cannot be given. Only one of them is ever
  // enabled, so only one ever runs.
  const meetingRead = $derived(eventKind === "matter" ? matterEventRead : firmEventRead);

  const summary = $derived(meetingRead.data ?? null);
  const running = $derived(summary !== null && summary.status !== "ended" ? summary : null);
  /*
   * Whether this deployment carries meetings at all. Unknown while the entry has no meeting, so the
   * answer defaults to yes and the refusal, if there is one, is stated by the act rather than
   * guessed at here.
   */
  const configured = $derived(summary?.configured ?? true);

  /** Which of the two is being opened, or null while neither is. One at a time, so one flag. */
  let starting = $state<MeetingMedium | null>(null);
  let startFailure = $state<Failure | null>(null);
  /** Which of the two the last attempt was, so Retry asks for the one that was pressed. */
  let lastAttempt = $state<MeetingMedium>("video");
  /*
   * Whether arrivals are held at a door, chosen before the room opens.
   *
   * OFF BY DEFAULT, because every participant today is a firm member arriving at an event they are
   * already on, and a lobby on by default would put a colleague in a queue for every ordinary
   * hearing. It is a standing the room OPENS with rather than a setting of the meeting's: a host
   * changes it from inside, and this control has nothing to say about a room that already exists.
   */
  let holdArrivals = $state(false);

  async function start(medium: MeetingMedium): Promise<void> {
    if (starting !== null) return;
    starting = medium;
    lastAttempt = medium;
    startFailure = null;
    const outcome = await startMeeting(eventKind, eventId, medium, holdArrivals ? "on" : "off");
    starting = null;
    if (outcome.kind === "ok") {
      await goto(`/meetings/${outcome.value.id}`);
      return;
    }
    startFailure = outcome.failure;
  }

  /** What the running room is called, which is what its Join control has to say. */
  const joinLabel = $derived(running?.medium === "audio" ? "Join Call" : "Join Meeting");

  /*
   * A room whose host has shut the door.
   *
   * THE CONTROL SAYS SO BEFORE THE CLICK RATHER THAN AFTER IT, which is the whole reason the summary
   * carries the fact: a Join that opens the room screen and is refused there has walked a member
   * through two screens to tell them what one word could. It is disabled with the reason rather than
   * absent, because this IS something that could happen here — the door opens again the moment a
   * host unlocks it, and a control that vanished would leave a reader wondering what they missed.
   */
  const locked = $derived(running !== null && running.locked);
  const lockedReason = $derived(
    running?.medium === "audio"
      ? "A host has locked this call, so nobody else can come in."
      : "A host has locked this meeting, so nobody else can come in.",
  );

  /*
   * WHO FROM OUTSIDE THE FIRM MAY COME, from the entry the meeting hangs on. A host is as likely to
   * send a client their link the morning before as from inside the room, and the entry window is
   * where the event's participants — the only people a link can be sent to — are already read.
   * Offered once a meeting exists on the entry, because a link is minted for a meeting.
   */
  let guestsOpen = $state(false);
</script>

{#if canJoin && configured && canHost && running !== null}
  <Button
    variant="secondary"
    title="Who from outside the firm may come to this meeting"
    onclick={() => (guestsOpen = true)}
  >
    <UsersRound class="size-16" aria-hidden="true" />
    Guests
  </Button>
  <MeetingGuestsPanel
    bind:open={guestsOpen}
    subject={{ facts: [running.title] }}
    meetingId={running.id}
    {eventKind}
    {eventId}
  />
{/if}

{#if canJoin && configured}
  {#if locked}
    <Button variant="secondary" disabled title={lockedReason}>
      <Lock class="size-16" aria-hidden="true" />
      Locked
    </Button>
  {:else if running !== null}
    <Button
      variant="secondary"
      title={running.medium === "audio"
        ? "Go into the call running on this entry"
        : "Go into the meeting running on this entry"}
      onclick={() => void goto(`/meetings/${running.id}`)}
    >
      {#if running.medium === "audio"}
        <Phone class="size-16" aria-hidden="true" />
      {:else}
        <Video class="size-16" aria-hidden="true" />
      {/if}
      <!-- The count is stated even when it is none: a room stays open until a host ends it, so an
           empty one is an ordinary standing, and "Join Meeting" with nothing beside it reads as a
           room somebody is in. -->
      {joinLabel} ({running.liveCount})
    </Button>
  {:else if canHost && startable && !meetingRead.isPending}
    <!-- TWO CONTROLS, NOT A CONTROL WITH A CHOICE INSIDE IT. A call and a meeting are different
         rooms to be in, and which one is being opened is decided before anything opens rather than
         in a menu that hides the second answer. They sit on one row; whatever came of pressing
         either stacks under both, so a refusal states itself where the act happened and the way to
         try again is the same button, still in its own place. -->
    <div class="flex flex-col items-start gap-8">
      <div class="flex flex-wrap items-center gap-8">
        <Button
          variant="secondary"
          disabled={starting !== null}
          title="Open a video meeting on this entry and go into it"
          onclick={() => void start("video")}
        >
          <Video class="size-16" aria-hidden="true" />
          Start Meeting
        </Button>
        <Button
          variant="secondary"
          disabled={starting !== null}
          title="Open a call on this entry and go into it — sound only, no cameras"
          onclick={() => void start("audio")}
        >
          <Phone class="size-16" aria-hidden="true" />
          Start Call
        </Button>
      </div>
      <!-- THE ONE THING DECIDED BEFORE THE ROOM OPENS RATHER THAN INSIDE IT, and it sits beside both
           controls because it is true of whichever one is pressed. A host changes it from inside the
           meeting afterwards: who may come in is a standing decision of theirs and has no bearing on
           what the people already in the room agreed to. -->
      <div class="flex items-center gap-8">
        <Switch
          aria-labelledby="{eventId}-hold-arrivals-label"
          bind:checked={holdArrivals}
          disabled={starting !== null}
        />
        <!-- The same words the event form asks it in, from the one home they are written in: two
             spellings of one control is how a reader learns that two parts of one product were
             written by two people. -->
        <Label id="{eventId}-hold-arrivals-label">{MEETING_LOBBY_LABEL}</Label>
      </div>
      {#if startFailure !== null}
        <FailureNotice
          failure={startFailure}
          subject="This meeting"
          title="Nothing Was Opened"
          fallback="The room was not opened."
          whenSilent="Nothing answered. The room was not opened."
          onRetry={() => void start(lastAttempt)}
        />
      {/if}
    </div>
  {/if}
{/if}
