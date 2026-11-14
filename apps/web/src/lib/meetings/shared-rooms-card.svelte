<script lang="ts">
  /*
   * Shared Rooms: the rooms the firm keeps for a place, such as "Red Room" or "Large Conference
   * Room", on the Meetings page.
   *
   * A SHARED ROOM STANDS FOR A PLACE, NOT A PERSON. Anybody who may host meetings sets one up, opens
   * it, renames it and takes it off the list; anybody who may join sees the list, copies a link and
   * joins a room that is open. A session is an ordinary meeting on the opener's calendar.
   *
   * THE LINK FOLLOWS THE NAME (/room/red-room), so renaming a room moves its link, and the rename
   * dialog says the old one stops working.
   *
   * The list is read again on a short interval, like Firm Rooms, so "In a meeting" turns up without
   * a reload.
   */
  import Copy from "@lucide/svelte/icons/copy";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import Plus from "@lucide/svelte/icons/plus";
  import Video from "@lucide/svelte/icons/video";
  import { createQuery } from "@tanstack/svelte-query";
  import { meetingsListSharedRoomsOptions, type SharedRoom } from "@magna-carta/api-client";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import * as Card from "@magna-carta/design-system/card";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import { toast } from "@magna-carta/design-system/toast";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { failureOf } from "$lib/api/api-client.ts";
  import { MEETING_LOBBY_LABEL } from "$lib/calendar/event-draft.ts";
  import { pageRecordingSounds } from "./client/recording-sounds.ts";
  import { reserveMeetingTab } from "./meeting-tab.ts";
  import {
    createSharedRoom,
    openRoomAtAddress,
    personalRoomAddress,
    retireSharedRoom,
    updateSharedRoom,
  } from "./personal-room-api.ts";
  import { sharedRoomStatus } from "./firm-rooms.ts";
  import RoomNameDialog from "./room-name-dialog.svelte";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { Failure } from "$lib/api/problem.ts";

  let { canHost }: { /** Whether the reader may set up, open and change these rooms. */ canHost: boolean } =
    $props();

  /** How often the list is read again while it is on screen. */
  const SHARED_ROOMS_READ_INTERVAL_MILLISECONDS = 30_000;

  const read = createQuery(() => ({
    ...meetingsListSharedRoomsOptions(),
    refetchInterval: SHARED_ROOMS_READ_INTERVAL_MILLISECONDS,
  }));

  const rooms = $derived(read.data?.rooms ?? []);
  const origin = globalThis.location?.origin ?? "";

  let creating = $state(false);
  let renamingRoom = $state<SharedRoom | null>(null);
  let renameOpen = $state(false);
  let retiringRoom = $state<SharedRoom | null>(null);
  let retireOpen = $state(false);
  let busy = $state(false);
  let writeFailure = $state<Failure | null>(null);

  async function settled(outcome: { kind: "ok" } | { kind: "failed"; failure: Failure }) {
    if (outcome.kind !== "ok") return outcome.failure;
    await read.refetch();
    return null;
  }

  async function copyLink(room: SharedRoom): Promise<void> {
    try {
      await navigator.clipboard.writeText(personalRoomAddress(room.addressName, origin));
      toast.success(`${room.name} link copied.`);
    } catch {
      toast.error("Your browser would not copy it. Open the room and copy its address instead.");
    }
  }

  /*
   * Into the room. The tone's device is woken and the meeting's tab reserved on the press, before
   * anything is awaited, for the reasons `my-room-card.svelte` gives.
   */
  async function enter(room: SharedRoom): Promise<void> {
    if (busy) return;
    pageRecordingSounds.unlock();
    const tab = reserveMeetingTab();
    busy = true;
    writeFailure = null;
    const outcome = await openRoomAtAddress(room.addressName);
    busy = false;
    if (outcome.kind !== "ok") {
      tab.cancel();
      writeFailure = outcome.failure;
      return;
    }
    tab.open(outcome.value.meetingId, outcome.value.joinCode);
  }

  async function change(
    room: SharedRoom,
    update: { medium?: "video" | "audio"; lobby?: "on" | "off" },
  ): Promise<void> {
    writeFailure = await settled(await updateSharedRoom(room.id, update));
  }

  async function retire(): Promise<ActionOutcome> {
    if (retiringRoom === null) return "refused";
    writeFailure = await settled(await retireSharedRoom(retiringRoom.id));
    return writeFailure === null ? "committed" : "refused";
  }
</script>

<Card.Root>
  <Card.Header>
    <div class="flex items-start justify-between gap-8">
      <Card.Title>Shared Rooms</Card.Title>
      {#if canHost}
        <Button variant="secondary" size="sm" onclick={() => (creating = true)}>
          <Plus aria-hidden="true" />
          New Room
        </Button>
      {/if}
    </div>
    <Card.Description>
      Rooms the firm keeps for a place, such as a conference room. Anyone who can host meetings opens
      them, and each meeting goes on that person's calendar.
    </Card.Description>
  </Card.Header>
  <Card.Content class="flex flex-col gap-16">
    {#if read.isError}
      <FailureNotice
        failure={failureOf(read.error)}
        subject="The firm's shared rooms"
        title="Rooms Not Read"
        fallback="The shared rooms could not be read."
        whenSilent="Couldn't connect. Reload the page to try again."
      />
    {:else if read.isPending}
      <p class="text-sm text-text-muted">Reading the shared rooms</p>
    {:else if rooms.length === 0}
      <p class="text-sm text-text-muted">
        No shared rooms yet.{#if canHost}
          Press New Room to set one up.{/if}
      </p>
    {:else}
      <ul class="flex flex-col divide-y divide-border-default" aria-label="Shared rooms">
        {#each rooms as room (room.id)}
          {@const status = sharedRoomStatus(room)}
          <li class="flex flex-wrap items-center gap-8 py-8">
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-sm font-medium" title={room.name}>{room.name}</span>
              <span class="truncate text-xs text-text-muted">/room/{room.addressName}</span>
            </span>
            <span class={status.open ? "text-sm text-text-default" : "text-sm text-text-muted"}
              >{status.text}</span
            >
            <span class="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onclick={() => void copyLink(room)}
                aria-label="Copy the {room.name} link"
              >
                <Copy aria-hidden="true" />
                Copy Link
              </Button>
              {#if canHost}
                <Button variant="secondary" size="sm" disabled={busy} onclick={() => void enter(room)}>
                  <Video aria-hidden="true" />
                  {status.open ? "Go to Room" : "Open Room"}
                </Button>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger
                    class={buttonClasses({ variant: "ghost", size: "icon-sm" })}
                    aria-label="{room.name} settings"
                  >
                    <Ellipsis class="size-16" aria-hidden="true" />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end">
                    <DropdownMenu.Item
                      onSelect={() => {
                        renamingRoom = room;
                        renameOpen = true;
                      }}>Rename Room</DropdownMenu.Item
                    >
                    <DropdownMenu.Separator />
                    <DropdownMenu.CheckboxItem
                      checked={room.lobby === "on"}
                      closeOnSelect={false}
                      onCheckedChange={(on) =>
                        void change(room, { lobby: on === true ? "on" : "off" })}
                    >
                      {MEETING_LOBBY_LABEL}
                    </DropdownMenu.CheckboxItem>
                    <DropdownMenu.CheckboxItem
                      checked={room.medium === "audio"}
                      closeOnSelect={false}
                      onCheckedChange={(on) =>
                        void change(room, { medium: on === true ? "audio" : "video" })}
                    >
                      Open as an audio call
                    </DropdownMenu.CheckboxItem>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item
                      onSelect={() => {
                        retiringRoom = room;
                        retireOpen = true;
                      }}>Remove Room</DropdownMenu.Item
                    >
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              {:else if status.open}
                <Button variant="secondary" size="sm" href={`/room/${room.addressName}`}>
                  <Video aria-hidden="true" />
                  Join
                </Button>
              {/if}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
    {#if writeFailure !== null}
      <FailureNotice
        failure={writeFailure}
        subject="The room"
        title="Nothing Changed"
        fallback="That did not happen."
        whenSilent="Couldn't connect. Nothing changed. Try again."
      />
    {/if}
  </Card.Content>
</Card.Root>

<RoomNameDialog
  bind:open={creating}
  heading="New Shared Room"
  currentName=""
  commitLabel="Set Up Room"
  note="The room's link is made from its name, such as /room/red-room."
  onSave={async (name) => settled(await createSharedRoom(name))}
/>

{#if renamingRoom !== null}
  {@const room = renamingRoom}
  <RoomNameDialog
    bind:open={renameOpen}
    heading="Rename Room"
    currentName={room.name}
    note="The room's link changes to match the new name, and the old link stops working."
    onSave={async (name) => settled(await updateSharedRoom(room.id, { title: name }))}
  />
{/if}

<ActionDialog
  bind:open={retireOpen}
  kind="destructive"
  heading="Remove Room"
  commitLabel="Remove the Room"
  commitBusyLabel="Removing"
  unsavedChanges={false}
  onCommit={retire}
>
  {#snippet fields()}
    <p class="text-sm">
      {retiringRoom?.name ?? "The room"} comes off the list and its link stops working. A meeting in
      it now carries on, and its past meetings stay on the record.
    </p>
  {/snippet}
</ActionDialog>
