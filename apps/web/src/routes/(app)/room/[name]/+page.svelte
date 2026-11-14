<script lang="ts">
  /*
   * A colleague's room, reached by its address: /room/trevor.
   *
   * CLOSED IS AN ORDINARY STATE, NOT A FAILURE. A link is standing, so most arrivals land while the
   * owner is not in; the page says so plainly and reads again on a short interval, so a member who
   * waits sees the Join control appear without reloading.
   *
   * JOINING IS TWO STEPS ON ONE PRESS. The arrive call puts the member on the session's calendar
   * event (so the room's own join, which asks whether the member is on the event, admits them) and
   * hands back the meeting; the page then goes to the ordinary room screen. Nothing about the room
   * itself is drawn here.
   *
   * WHOEVER MAY OPEN THE ROOM is offered Open: the owner of a member's room, and anybody who may host
   * for one of the firm's shared rooms ("Red Room"), which stands for a place rather than a person.
   */
  import { createQuery } from "@tanstack/svelte-query";
  import { meetingsReadRoomLinkOptions } from "@magna-carta/api-client";
  import Video from "@lucide/svelte/icons/video";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { failureOf } from "$lib/api/api-client.ts";
  import { meetingRoomAddress } from "$lib/meetings/meeting-tab.ts";
  import { refusedAs } from "$lib/meetings/meetings-api.ts";
  import { arriveAtRoom, openRoomAtAddress } from "$lib/meetings/personal-room-api.ts";
  import { pageRecordingSounds } from "$lib/meetings/client/recording-sounds.ts";
  import type { Failure } from "$lib/api/problem.ts";

  /** How often a closed room is read again while somebody waits at it. */
  const CLOSED_ROOM_READ_INTERVAL_MILLISECONDS = 10_000;

  // The room's address name. The routes still call it the link.
  const linkCode = $derived(page.params.name ?? "");

  const read = createQuery(() => ({
    ...meetingsReadRoomLinkOptions({ path: { linkCode } }),
    refetchInterval: (query: { state: { data?: { state: string } } }) =>
      query.state.data?.state === "closed" ? CLOSED_ROOM_READ_INTERVAL_MILLISECONDS : false,
  }));

  const room = $derived(read.data ?? null);
  const unknown = $derived(read.isError && refusedAs(failureOf(read.error), "personal-room-not-found"));

  let busy = $state(false);
  let writeFailure = $state<Failure | null>(null);

  /*
   * The tone's device is woken on the press, before anything is awaited, for the reason
   * `meeting-entry-action.svelte` gives.
   */
  async function join(): Promise<void> {
    if (busy) return;
    pageRecordingSounds.unlock();
    busy = true;
    writeFailure = null;
    const outcome = await arriveAtRoom(linkCode);
    busy = false;
    if (outcome.kind !== "ok") {
      writeFailure = outcome.failure;
      return;
    }
    if (outcome.value.meetingId === null) {
      // The owner left between the read and the press: show the closed room again.
      await read.refetch();
      return;
    }
    await goto(meetingRoomAddress(outcome.value.meetingId, outcome.value.joinCode));
  }

  async function open(): Promise<void> {
    if (busy) return;
    pageRecordingSounds.unlock();
    busy = true;
    writeFailure = null;
    const outcome = await openRoomAtAddress(linkCode);
    busy = false;
    if (outcome.kind !== "ok") {
      writeFailure = outcome.failure;
      return;
    }
    await goto(meetingRoomAddress(outcome.value.meetingId, outcome.value.joinCode));
  }

  const title = $derived(room === null ? "Room" : room.roomName);

</script>

<svelte:head><title>{title} · Magna Carta</title></svelte:head>

<div class="flex flex-col gap-24">
  <ScreenHeader {title} back="meetings" />

  {#if unknown}
    <EmptyState title="No Room at This Link">
      The link may have been replaced. Ask whoever sent it for the current one.
    </EmptyState>
  {:else if read.isError}
    <FailureNotice
      failure={failureOf(read.error)}
      subject="This room"
      title="The Room Could Not Be Read"
      fallback="The room could not be read."
      whenSilent="Nothing answered, so the room could not be read."
    />
  {:else if room === null}
    <p class="text-sm text-text-muted">Reading the room</p>
  {:else if room.mayOpen}
    <EmptyState title={room.isOwner ? "This Is Your Room" : room.roomName}>
      {room.state === "open"
        ? "The room is open."
        : "Open it and colleagues with the link can join. The meeting goes on your calendar."}
      {#snippet actions()}
        <Button onclick={open} disabled={busy}>
          <Video aria-hidden="true" />
          {room.state === "open" ? "Go to the Room" : "Open the Room"}
        </Button>
      {/snippet}
    </EmptyState>
  {:else if room.state === "closed"}
    <EmptyState title="{room.roomName} Is Not Open Yet">
      This page checks again every few seconds. Join appears as soon as {room.kind === "shared"
        ? "somebody opens it"
        : `${room.ownerDisplayName} opens it`}.
    </EmptyState>
  {:else}
    <EmptyState title="{room.roomName} Is Open">
      Joining puts this meeting on your calendar.
      {#snippet actions()}
        <Button onclick={join} disabled={busy}>
          <Video aria-hidden="true" />
          {busy ? "Joining" : "Join"}
        </Button>
      {/snippet}
    </EmptyState>
  {/if}

  {#if writeFailure !== null}
    <FailureNotice
      failure={writeFailure}
      subject="This room"
      title="You Did Not Join"
      fallback="That did not happen."
      whenSilent="Nothing answered, so you did not join."
    />
  {/if}
</div>
