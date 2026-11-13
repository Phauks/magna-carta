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
   * GETTING A NEW LINK ASKS FIRST, because the old address stops working at once and anybody who
   * was sent it is turned away.
   *
   * THE CARD IS A HOST'S. Having a room is `meetings:host`; the page draws this only where the
   * session holds it, and the server refuses it otherwise.
   */
  import Copy from "@lucide/svelte/icons/copy";
  import Video from "@lucide/svelte/icons/video";
  import { createQuery } from "@tanstack/svelte-query";
  import { meetingsReadPersonalRoomOptions } from "@magna-carta/api-client";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import Button from "@magna-carta/design-system/button";
  import * as Card from "@magna-carta/design-system/card";
  import Label from "@magna-carta/design-system/label";
  import Switch from "@magna-carta/design-system/switch";
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
    replacePersonalRoomLink,
    updatePersonalRoom,
  } from "./personal-room-api.ts";
  import type { MeetingWrite } from "./meetings-api.ts";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { PersonalRoomResponse } from "@magna-carta/api-client";
  import type { Failure } from "$lib/api/problem.ts";

  const read = createQuery(() => meetingsReadPersonalRoomOptions());

  const room = $derived(read.data?.room ?? null);
  const address = $derived(
    room === null ? "" : personalRoomAddress(room.linkCode, globalThis.location?.origin ?? ""),
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

  let replacing = $state(false);

  async function replace(): Promise<ActionOutcome> {
    return (await settle(await replacePersonalRoomLink())) ? "committed" : "refused";
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
    <Card.Title>My Room</Card.Title>
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
      <div class="flex flex-col gap-8">
        <div class="flex items-center justify-between gap-16">
          <Label for="my-room-lobby">{MEETING_LOBBY_LABEL}</Label>
          <Switch
            id="my-room-lobby"
            disabled={busy}
            checked={room.lobby === "on"}
            onCheckedChange={(checked: boolean) => void change({ lobby: checked ? "on" : "off" })}
          />
        </div>
        <div class="flex items-center justify-between gap-16">
          <Label for="my-room-audio">Open as an audio call</Label>
          <Switch
            id="my-room-audio"
            disabled={busy}
            checked={room.medium === "audio"}
            onCheckedChange={(checked: boolean) =>
              void change({ medium: checked ? "audio" : "video" })}
          />
        </div>
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
      <Button variant="ghost" onclick={() => (replacing = true)} disabled={busy}>Get a New Link</Button>
    </Card.Footer>
  {/if}
</Card.Root>

<ActionDialog
  bind:open={replacing}
  kind="destructive"
  heading="Change Your Room Link"
  commitLabel="Get a New Link"
  commitBusyLabel="Replacing"
  unsavedChanges={false}
  onCommit={replace}
>
  {#snippet notice()}
    {#if writeFailure !== null}
      {@render refusal(writeFailure)}
    {/if}
  {/snippet}
  {#snippet fields()}
    <p class="text-sm">
      Your room gets a new address and the old one stops working at once. Anybody you sent the old
      link to will need the new one.
    </p>
  {/snippet}
</ActionDialog>
