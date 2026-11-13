<script lang="ts">
  /*
   * Firm Rooms: every member's standing room, on the Meetings page, whether or not anybody is in it.
   *
   * A ROOM'S LINK IS WORTH HAVING BEFORE THE ROOM IS OPEN. Somebody arranging a call with a colleague
   * wants the colleague's link to send now, not when the colleague next opens the room, so each row
   * offers Copy Link whatever the room is doing. Join appears only while a session is open; the link
   * page itself waits at a closed room, so following a link early is never a dead end.
   *
   * A MEMBER WITHOUT A ROOM IS STILL LISTED, saying so, so the list reads as the firm rather than as
   * the subset that happened to set one up.
   *
   * WHAT A SESSION IS ABOUT IS NOT SHOWN. The server answers with a count and a meeting id only; the
   * matter a session hangs on stays behind the meeting reads and their visibility gate.
   *
   * The list is read again on a short interval, so "In a meeting" turns up without a reload.
   */
  import Copy from "@lucide/svelte/icons/copy";
  import Video from "@lucide/svelte/icons/video";
  import { createQuery } from "@tanstack/svelte-query";
  import { meetingsListFirmRoomsOptions, type FirmRoom } from "@magna-carta/api-client";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as Card from "@magna-carta/design-system/card";
  import { toast } from "@magna-carta/design-system/toast";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { failureOf } from "$lib/api/api-client.ts";
  import { personalRoomAddress } from "./personal-room-api.ts";
  import { firmRoomStatus } from "./firm-rooms.ts";

  /** How often the list is read again while it is on screen. */
  const FIRM_ROOMS_READ_INTERVAL_MILLISECONDS = 30_000;

  const read = createQuery(() => ({
    ...meetingsListFirmRoomsOptions(),
    refetchInterval: FIRM_ROOMS_READ_INTERVAL_MILLISECONDS,
  }));

  const rooms = $derived(read.data?.rooms ?? []);
  const origin = globalThis.location?.origin ?? "";

  async function copyLink(room: FirmRoom): Promise<void> {
    if (room.linkCode === null) return;
    try {
      await navigator.clipboard.writeText(personalRoomAddress(room.linkCode, origin));
      toast.success(`${room.name}'s room link copied.`);
    } catch {
      toast.error("Your browser would not copy it. Open the room and copy its address instead.");
    }
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>Firm Rooms</Card.Title>
    <Card.Description>
      Everyone's standing room. Copy a link to send it ahead of time, or join a room that is open.
    </Card.Description>
  </Card.Header>
  <Card.Content>
    {#if read.isError}
      <FailureNotice
        failure={failureOf(read.error)}
        subject="The firm's rooms"
        title="Rooms Not Read"
        fallback="The firm's rooms could not be read."
        whenSilent="Nothing answered, so the rooms could not be listed."
      />
    {:else if read.isPending}
      <p class="text-sm text-text-muted">Reading the firm's rooms</p>
    {:else}
      <ul class="flex flex-col divide-y divide-border-default" aria-label="Firm rooms">
        {#each rooms as room (room.userId)}
          {@const status = firmRoomStatus(room)}
          <li class="flex flex-wrap items-center gap-8 py-8">
            <span class="flex min-w-0 flex-1 items-center gap-8">
              <span class="truncate text-sm font-medium" title={room.name}>{room.name}</span>
              {#if room.isCaller}
                <Badge variant="neutral">You</Badge>
              {/if}
            </span>
            <span
              class={status.open ? "text-sm text-text-default" : "text-sm text-text-muted"}
              >{status.text}</span
            >
            {#if room.linkCode !== null}
              <span class="flex items-center gap-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={() => void copyLink(room)}
                  aria-label="Copy {room.name}'s room link"
                >
                  <Copy aria-hidden="true" />
                  Copy Link
                </Button>
                {#if status.open && !room.isCaller}
                  <Button variant="secondary" size="sm" href={`/meetings/rooms/${room.linkCode}`}>
                    <Video aria-hidden="true" />
                    Join
                  </Button>
                {/if}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </Card.Content>
</Card.Root>
