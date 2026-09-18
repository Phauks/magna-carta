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
  import Video from "@lucide/svelte/icons/video";
  import Button from "@magna-carta/design-system/button";
  import { createQuery } from "@tanstack/svelte-query";
  import {
    meetingsGetForEventOptions,
    meetingsGetForFirmEventOptions,
  } from "@magna-carta/api-client";
  import { goto } from "$app/navigation";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import { startMeeting } from "./meetings-api.ts";
  import type { Failure } from "$lib/api/problem.ts";

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

  let starting = $state(false);
  let startFailure = $state<Failure | null>(null);

  async function start(): Promise<void> {
    if (starting) return;
    starting = true;
    startFailure = null;
    const outcome = await startMeeting(eventKind, eventId);
    starting = false;
    if (outcome.kind === "ok") {
      await goto(`/meetings/${outcome.value.id}`);
      return;
    }
    startFailure = outcome.failure;
  }
</script>

{#if canJoin && configured}
  {#if running !== null}
    <Button
      variant="secondary"
      title="Go into the meeting running on this entry"
      onclick={() => void goto(`/meetings/${running.id}`)}
    >
      <Video class="size-16" aria-hidden="true" />
      <!-- The count is stated even when it is none: a meeting stays open until a host ends it, so an
           empty room is an ordinary standing, and "Join Meeting" with nothing beside it reads as a
           room somebody is in. -->
      Join Meeting ({running.liveCount})
    </Button>
  {:else if canHost && startable && !meetingRead.isPending}
    <!-- The control and whatever came of pressing it stack, so a refusal states itself where the
         act happened and the way to try again is the same button, still in its own place. -->
    <div class="flex flex-col items-start gap-8">
      <Button
        variant="secondary"
        disabled={starting}
        title="Open a meeting on this entry and go into it"
        onclick={() => void start()}
      >
        <Video class="size-16" aria-hidden="true" />
        Start Meeting
      </Button>
      {#if startFailure !== null}
        <FailureNotice
          failure={startFailure}
          subject="This meeting"
          title="No Meeting Was Opened"
          fallback="The meeting was not started."
          whenSilent="Nothing answered. The meeting was not started."
          onRetry={() => void start()}
        />
      {/if}
    </div>
  {/if}
{/if}
