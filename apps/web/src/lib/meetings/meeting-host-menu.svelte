<script lang="ts">
  /*
   * What a host may do about one person in the room, on their tile and on their row in the rail.
   *
   * ONE COMPONENT FOR BOTH PLACES, and the rail is the one that matters in a large meeting: sixteen
   * of three hundred people have a tile, and all three hundred have a row. A second menu written for
   * the rail would be the same six items in a different order within a week.
   *
   * A NON-HOST SEES NONE OF IT — absent, not disabled, on the standing rule this room already keeps
   * for its control bar. A disabled control says "this could happen here and does not", and for a
   * member who is not running the meeting it could not happen here at all. The same rule decides the
   * items INSIDE the menu: a co-host is not offered the acts the route would refuse them.
   *
   * MOST ITEMS ARE IMMEDIATE, AND TWO ARE NOT. A confirmation on Mute would make the control slower
   * than saying the person's name across the table. Removing somebody and handing them the room are
   * the two that cannot be taken back on the presser's own say-so — one puts a member out of a
   * meeting on a matter's record, the other needs the other person's cooperation to undo — so both
   * go behind the one panel the product asks acts in.
   */
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import Focus from "@lucide/svelte/icons/focus";
  import Hand from "@lucide/svelte/icons/hand";
  import MicOff from "@lucide/svelte/icons/mic-off";
  import ShieldUser from "@lucide/svelte/icons/shield-user";
  import UserMinus from "@lucide/svelte/icons/user-minus";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import type { MeetingHostRole } from "@magna-carta/meeting-protocol/types";
  import { mayActOn } from "./client/meeting-client.svelte.ts";
  import { hostRoleLabel } from "./screen/meeting-host-labels.ts";
  import type { Snippet } from "svelte";

  let {
    name,
    viewerRole,
    targetRole = null,
    spotlighted = false,
    onMute,
    onAskToUnmute,
    onSpotlight,
    onMakeCoHost,
    onWithdrawCoHost,
    onHandHosting,
    onRemove,
    writeFailure,
  }: {
    /** Who this menu is about, as the roster states them. It names every item a reader hears. */
    name: string;
    /** How the member reading runs this meeting. Null renders nothing at all. */
    viewerRole: MeetingHostRole | null;
    /** How the person this menu is about runs it, where they do. */
    targetRole?: MeetingHostRole | null;
    /** Whether they are already on every screen in the room. */
    spotlighted?: boolean;
    onMute: () => void;
    onAskToUnmute: () => void;
    /** Put them on every screen, or take whoever is there off it. */
    onSpotlight: (spotlighted: boolean) => void;
    /** Name them a co-host. Reports how the write went, so the menu's panel can stand its ground. */
    onMakeCoHost: () => void;
    onWithdrawCoHost: () => void;
    /** Hand them the room. Behind the panel, because it cannot be undone from this side. */
    onHandHosting: () => Promise<ActionOutcome>;
    /** Put them out of the room. Behind the panel, and the panel is the destructive kind. */
    onRemove: () => Promise<ActionOutcome>;
    /** A failed write, in the app's own words, rendered in whichever panel asked for it. */
    writeFailure?: Snippet;
  } = $props();

  /** Whether the reader may act on this person at all: a co-host does not act on the host. */
  const allowed = $derived(mayActOn(viewerRole, targetRole));
  /** Naming and withdrawing a co-host, and handing the room over, are the host's own acts. */
  const isHost = $derived(viewerRole === "host");

  let removing = $state(false);
  let handingOver = $state(false);

  /** What each panel is about: the person, and how they stand in this room today. */
  const subject = $derived<RecordSubject>({
    facts: targetRole === null ? [name] : [name, hostRoleLabel(targetRole)],
  });
</script>

{#if allowed}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      class={buttonClasses({ variant: "ghost", size: "icon" })}
      aria-label="Host controls for {name}"
    >
      <Ellipsis class="size-16" aria-hidden="true" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" style="inline-size: var(--mc-size-popover)">
      <DropdownMenu.Item onSelect={onMute}>
        <MicOff class="size-16 shrink-0" aria-hidden="true" />
        Mute
      </DropdownMenu.Item>
      <!-- ASKING IS NOT UNMUTING, and nothing here can be. Their screen offers them Unmute and Stay
           muted, and their microphone stays shut until they choose. -->
      <DropdownMenu.Item onSelect={onAskToUnmute}>
        <Hand class="size-16 shrink-0" aria-hidden="true" />
        Ask to Unmute
      </DropdownMenu.Item>
      <DropdownMenu.Item onSelect={() => onSpotlight(!spotlighted)}>
        <Focus class="size-16 shrink-0" aria-hidden="true" />
        {spotlighted ? "Stop Spotlighting" : "Spotlight for Everyone"}
      </DropdownMenu.Item>

      {#if isHost}
        <DropdownMenu.Separator />
        {#if targetRole === "co-host"}
          <DropdownMenu.Item onSelect={onWithdrawCoHost}>
            <ShieldUser class="size-16 shrink-0" aria-hidden="true" />
            Withdraw Co-host
          </DropdownMenu.Item>
        {:else}
          <DropdownMenu.Item onSelect={onMakeCoHost}>
            <ShieldUser class="size-16 shrink-0" aria-hidden="true" />
            Make Co-host
          </DropdownMenu.Item>
        {/if}
        <DropdownMenu.Item onSelect={() => (handingOver = true)}>
          <ShieldUser class="size-16 shrink-0" aria-hidden="true" />
          Hand Hosting Over
        </DropdownMenu.Item>
      {/if}

      <DropdownMenu.Separator />
      <DropdownMenu.Item onSelect={() => (removing = true)}>
        <UserMinus class="size-16 shrink-0" aria-hidden="true" />
        Remove from the Meeting
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>

  <ActionDialog
    bind:open={removing}
    kind="destructive"
    heading="Remove from the Meeting"
    subtitle={subject}
    commitLabel="Remove"
    commitBusyLabel="Removing"
    unsavedChanges={false}
    onCommit={onRemove}
  >
    {#snippet notice()}
      {@render writeFailure?.()}
    {/snippet}

    {#snippet fields()}
      <p class="text-sm">
        They are taken out of the room and cannot come back into this meeting. Their stay closes on
        the record with the reason, and a new meeting on this event is a new room.
      </p>
    {/snippet}
  </ActionDialog>

  <ActionDialog
    bind:open={handingOver}
    kind="confirm"
    heading="Change Who Is Hosting"
    subtitle={subject}
    commitLabel="Hand It Over"
    commitBusyLabel="Handing It Over"
    unsavedChanges={false}
    onCommit={onHandHosting}
  >
    {#snippet notice()}
      {@render writeFailure?.()}
    {/snippet}

    {#snippet fields()}
      <p class="text-sm">
        They run the meeting from now on and you become a co-host. Taking it back needs them to hand
        it to you, so this is not a step you can walk back on your own.
      </p>
    {/snippet}
  </ActionDialog>
{/if}
