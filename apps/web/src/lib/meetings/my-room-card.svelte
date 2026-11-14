<script lang="ts">
  /*
   * My Room: the member's standing room, on the Meetings page.
   *
   * A ROOM IS A LINK THAT DOES NOT CHANGE. A colleague who has it can come back to it next week and
   * find the same address, so the card leads with the address and the Copy control beside it. Each
   * time the owner opens the room a session starts on the calendar as an ordinary event in their
   * name, so nothing here schedules anything.
   *
   * NOTHING IS MADE BY LOOKING. A member who has never had a room sees what one is and a Set Up
   * control, because a read that wrote a record would hand every host a link they never asked for.
   *
   * THE ADDRESS IS THE OWNER'S NAME (/room/trevor), made with the room and never changed, so there
   * is no Get a New Link here: the room's older code address still works, and the server can still
   * replace it, but nothing a member copies today names it.
   *
   * THE SETTINGS LIVE BEHIND "...", beside the card's title. They are changed once and rarely, so
   * the card's face is kept for what a member does every day: copy the link and go in.
   *
   * THE CARD IS A HOST'S. Having a room is `meetings:host`; the page draws this only where the
   * session holds it, and the server refuses it otherwise.
   */
  import Copy from "@lucide/svelte/icons/copy";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import Video from "@lucide/svelte/icons/video";
  import { createQuery } from "@tanstack/svelte-query";
  import { meetingsReadPersonalRoomOptions } from "@magna-carta/api-client";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import * as Card from "@magna-carta/design-system/card";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import { toast } from "@magna-carta/design-system/toast";
  import { reserveMeetingTab } from "./meeting-tab.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { failureOf } from "$lib/api/api-client.ts";
  import { MEETING_LOBBY_LABEL } from "$lib/calendar/event-draft.ts";
  import { pageRecordingSounds } from "./client/recording-sounds.ts";
  import {
    ensurePersonalRoom,
    openPersonalRoom,
    personalRoomAddress,
    updatePersonalRoom,
  } from "./personal-room-api.ts";
  import type { MeetingWrite } from "./meetings-api.ts";
  import type { PersonalRoomResponse } from "@magna-carta/api-client";
  import type { Failure } from "$lib/api/problem.ts";

  const read = createQuery(() => meetingsReadPersonalRoomOptions());

  const room = $derived(read.data?.room ?? null);
  const address = $derived(
    room === null ? "" : personalRoomAddress(room.addressName, globalThis.location?.origin ?? ""),
  );

  /** The last refused act, drawn in the card. */
  let writeFailure = $state<Failure | null>(null);
  let busy = $state(false);

  async function settle(outcome: MeetingWrite<PersonalRoomResponse>): Promise<boolean> {
    if (outcome.kind !== "ok") {
      writeFailure = outcome.failure;
      return false;
    }
    writeFailure = null;
    await read.refetch();
    return true;
  }

  async function setUp(): Promise<void> {
    if (busy) return;
    busy = true;
    await settle(await ensurePersonalRoom());
    busy = false;
  }

  async function change(update: { medium?: "video" | "audio"; lobby?: "on" | "off" }): Promise<void> {
    busy = true;
    await settle(await updatePersonalRoom(update));
    busy = false;
  }

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Room link copied.");
    } catch {
      // Some locked-down browsers refuse the clipboard; the address is on the screen to select.
      toast.error("Your browser would not copy it. Select the address and copy it instead.");
    }
  }

  /*
   * Into the room. The recording tone's device is woken on this press, before anything is awaited,
   * for the reason `meeting-entry-action.svelte` gives: Safari keeps a device woken outside a press
   * suspended, and the room arrives from an effect after the navigation.
   */
  async function enter(): Promise<void> {
    if (busy) return;
    pageRecordingSounds.unlock();
    // The meeting's own tab, reserved now while the press still lets a page open one.
    const tab = reserveMeetingTab();
    busy = true;
    writeFailure = null;
    const outcome = await openPersonalRoom();
    busy = false;
    if (outcome.kind !== "ok") {
      tab.cancel();
      writeFailure = outcome.failure;
      return;
    }
    tab.open(outcome.value.meetingId);
  }

</script>

{#snippet refusal(failure: Failure)}
  <FailureNotice
    {failure}
    subject="Your room"
    title="Nothing Changed"
    fallback="That did not happen."
    whenSilent="Nothing answered, so nothing changed for your room."
  />
{/snippet}

<Card.Root>
  <Card.Header>
    <div class="flex items-start justify-between gap-8">
      <Card.Title>My Room</Card.Title>
      {#if room !== null}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            class={buttonClasses({ variant: "ghost", size: "icon-sm" })}
            aria-label="My Room settings"
            disabled={busy}
          >
            <Ellipsis class="size-16" aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.CheckboxItem
              checked={room.lobby === "on"}
              closeOnSelect={false}
              onCheckedChange={(on) => void change({ lobby: on === true ? "on" : "off" })}
            >
              {MEETING_LOBBY_LABEL}
            </DropdownMenu.CheckboxItem>
            <DropdownMenu.CheckboxItem
              checked={room.medium === "audio"}
              closeOnSelect={false}
              onCheckedChange={(on) => void change({ medium: on === true ? "audio" : "video" })}
            >
              Open as an audio call
            </DropdownMenu.CheckboxItem>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      {/if}
    </div>
    <Card.Description>
      A standing link colleagues can use whenever you are in. Each time you open it, the meeting is
      put on your calendar, and you can move it onto a matter during the meeting or after it.
    </Card.Description>
  </Card.Header>
  <Card.Content class="flex flex-col gap-16">
    {#if read.isError}
      {@render refusal(failureOf(read.error))}
    {:else if read.isPending}
      <p class="text-sm text-text-muted">Reading your room</p>
    {:else if room === null}
      <div>
        <Button onclick={setUp} disabled={busy}>{busy ? "Setting Up" : "Set Up My Room"}</Button>
      </div>
    {:else}
      <div class="flex flex-wrap items-center gap-8">
        <code class="min-w-0 break-all rounded-sm bg-surface-sunken px-8 py-4 text-sm">{address}</code>
        <Button variant="secondary" size="sm" onclick={copyLink}>
          <Copy aria-hidden="true" />
          Copy Link
        </Button>
      </div>
    {/if}
    {#if writeFailure !== null}
      {@render refusal(writeFailure)}
    {/if}
  </Card.Content>
  {#if room !== null}
    <Card.Footer class="flex flex-wrap gap-8">
      <Button onclick={enter} disabled={busy}>
        <Video aria-hidden="true" />
        {room.openMeetingId === null ? "Open My Room" : "Go to My Room"}
      </Button>
    </Card.Footer>
  {/if}
</Card.Root>
