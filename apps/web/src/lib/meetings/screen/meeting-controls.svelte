<script lang="ts">
  /*
   * The control bar: what a member does while they are in the room.
   *
   * EACH TOGGLE IS ONE CONTROL, NOT TWO. Muting and unmuting are the same act read from either
   * side, so the control holds its place and changes its glyph and its fill — the house pattern for
   * a two-state control (a filled secondary while it is sending, quiet while it is not), with
   * `aria-pressed` carrying the state to a reader who cannot see the fill. A pair of buttons would
   * put the one you want in a different place depending on what you last did.
   *
   * THE BAND NAMES ITS CONTROLS ON HOVER, one name each. These are glyphs in a chrome band, which is
   * exactly the case the product answers with the design system's Tooltip rather than a native
   * title, so the delay, the placement and the look are the same as every other hover in the app.
   *
   * A CALL CARRIES FEWER CONTROLS, NOT DISABLED ONES. There is no camera in a call and no screen to
   * share into it, so those two are absent rather than greyed: a disabled control says "this could
   * happen here and does not", and neither could ever happen in a call.
   *
   * LEAVING AND ENDING ARE DIFFERENT ACTS AND LOOK IT. Leaving takes this member out of the room;
   * ending closes it for everybody and is the host's alone, so it is asked for behind the one panel
   * the product asks acts in. Only one of the two wears the loud register, because a band with two
   * red controls tells a reader nothing about which one is the dangerous one.
   */
  import Focus from "@lucide/svelte/icons/focus";
  import Lock from "@lucide/svelte/icons/lock";
  import LockOpen from "@lucide/svelte/icons/lock-open";
  import Mic from "@lucide/svelte/icons/mic";
  import Presentation from "@lucide/svelte/icons/presentation";
  import MicOff from "@lucide/svelte/icons/mic-off";
  import PhoneOff from "@lucide/svelte/icons/phone-off";
  import ScreenShare from "@lucide/svelte/icons/screen-share";
  import ScreenShareOff from "@lucide/svelte/icons/screen-share-off";
  import ShieldUser from "@lucide/svelte/icons/shield-user";
  import Square from "@lucide/svelte/icons/square";
  import Video from "@lucide/svelte/icons/video";
  import VideoOff from "@lucide/svelte/icons/video-off";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import type { MeetingMedium } from "@magna-carta/meeting-protocol/types";
  import type { Snippet } from "svelte";

  let {
    microphoneOn,
    cameraOn,
    sharing,
    speakerView = false,
    medium = "video",
    canEnd = false,
    hosting = false,
    locked = false,
    spotlighted = false,
    subtitle = {},
    onToggleMicrophone,
    onToggleCamera,
    onToggleSharing,
    onToggleSpeakerView,
    onMuteAll,
    onSetLocked,
    onClearSpotlight,
    onOpenHosts,
    onLeave,
    onEnd,
    connection,
    endFailure,
  }: {
    microphoneOn: boolean;
    cameraOn: boolean;
    sharing: boolean;
    /** Whether the room is drawn as one large speaker with a strip, rather than an even gallery. */
    speakerView?: boolean;
    /** What the room carries. A call has no camera control and no screen share. */
    medium?: MeetingMedium;
    /** Whether this member may end the meeting for everybody. */
    canEnd?: boolean;
    /**
     * Whether this member is running the meeting, and therefore whether the band carries the menu
     * of acts over the whole room at all.
     *
     * A NON-HOST SEES NONE OF IT: absent, not disabled, on this band's own standing rule. A band
     * that grew five controls only three people in the room can use would cost every other member
     * the space, and a disabled control would say "this could happen here" when it could not.
     */
    hosting?: boolean;
    /** Whether the door is shut, which is what the menu's item says next. */
    locked?: boolean;
    /** Whether anybody is on every screen in the room, which is what makes clearing it offerable. */
    spotlighted?: boolean;
    /** Which meeting is being ended, for the confirmation panel to name. */
    subtitle?: RecordSubject;
    onToggleMicrophone: () => void;
    onToggleCamera: () => void;
    onToggleSharing: () => void;
    /** Swap between the even gallery and the large speaker. Absent where it is not offered. */
    onToggleSpeakerView?: () => void;
    /** Silence everybody who is neither this member nor a host or co-host. */
    onMuteAll?: () => void;
    /** Shut the door, or open it again. */
    onSetLocked?: (locked: boolean) => void;
    /** Take whoever is on every screen off it. */
    onClearSpotlight?: () => void;
    /** Open the panel naming who is running this meeting. */
    onOpenHosts?: () => void;
    /**
     * The connection control, which the room screen supplies because the panel behind it is built
     * from what the room's own diagnostics hold. The band owns WHERE it sits; the control owns what
     * it says and what it opens.
     */
    connection?: Snippet;
    onLeave: () => void;
    /** Ends it for everybody. Reports how the write went, so the panel can stand its ground. */
    onEnd?: () => Promise<ActionOutcome>;
    /** A failed end, in the app's own words, rendered in the panel's reserved band. */
    endFailure?: Snippet;
  } = $props();

  let ending = $state(false);

  /** What ending this room is called. A call is not a meeting and is not ended as one. */
  const endLabel = $derived(medium === "audio" ? "End Call" : "End Meeting");
  /** The word the confirmation uses for the room itself, for the same reason. */
  const roomNoun = $derived(medium === "audio" ? "call" : "meeting");
</script>

<div
  class="flex flex-wrap items-center gap-8"
  role="group"
  aria-label={medium === "audio" ? "Call controls" : "Meeting controls"}
>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant={microphoneOn ? "secondary" : "ghost"}
          size="icon"
          aria-pressed={microphoneOn}
          aria-label={microphoneOn ? "Mute your microphone" : "Unmute your microphone"}
          onclick={onToggleMicrophone}
        >
          {#if microphoneOn}
            <Mic class="size-16" aria-hidden="true" />
          {:else}
            <MicOff class="size-16" aria-hidden="true" />
          {/if}
        </Button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="top">Microphone</Tooltip.Content>
  </Tooltip.Root>

  {#if medium === "video"}
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant={cameraOn ? "secondary" : "ghost"}
            size="icon"
            aria-pressed={cameraOn}
            aria-label={cameraOn ? "Turn your camera off" : "Turn your camera on"}
            onclick={onToggleCamera}
          >
            {#if cameraOn}
              <Video class="size-16" aria-hidden="true" />
            {:else}
              <VideoOff class="size-16" aria-hidden="true" />
            {/if}
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="top">Camera</Tooltip.Content>
    </Tooltip.Root>

    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant={sharing ? "secondary" : "ghost"}
            size="icon"
            aria-pressed={sharing}
            aria-label={sharing ? "Stop sharing your screen" : "Share your screen"}
            onclick={onToggleSharing}
          >
            {#if sharing}
              <ScreenShareOff class="size-16" aria-hidden="true" />
            {:else}
              <ScreenShare class="size-16" aria-hidden="true" />
            {/if}
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="top">Screen share</Tooltip.Content>
    </Tooltip.Root>

    {#if onToggleSpeakerView !== undefined}
      <!-- A view toggle whose glyph is the same on both sides, so the fill and `aria-pressed` are
           what say which side is on — the house pattern for exactly that case. -->
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant={speakerView ? "secondary" : "ghost"}
              size="icon"
              aria-pressed={speakerView}
              aria-label={speakerView ? "Show everybody" : "Show whoever is talking, large"}
              onclick={onToggleSpeakerView}
            >
              <Presentation class="size-16" aria-hidden="true" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">Speaker view</Tooltip.Content>
      </Tooltip.Root>
    {/if}
  {/if}

  <!-- The way to the numbers behind the marks. It is not a toggle, so it wears no fill and no
       pressed state: the band's other controls change what the room is doing, and this one only
       shows what it is already doing. -->
  {@render connection?.()}

  {#if hosting}
    <!-- ONE MENU RATHER THAN A ROW OF NEW GLYPHS. The acts over the whole room are four, and four
         more controls in a band every member reads would cost everybody else the space so that
         three people could save a click. -->
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class={buttonClasses({ variant: "secondary", size: "default" })}
        aria-label="Host controls"
      >
        <ShieldUser class="size-16" aria-hidden="true" />
        Host Controls
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" style="inline-size: var(--mc-size-popover)">
        <DropdownMenu.Item onSelect={() => onMuteAll?.()}>
          <MicOff class="size-16 shrink-0" aria-hidden="true" />
          Mute Everyone
        </DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => onSetLocked?.(!locked)}>
          {#if locked}
            <LockOpen class="size-16 shrink-0" aria-hidden="true" />
            Unlock the Room
          {:else}
            <Lock class="size-16 shrink-0" aria-hidden="true" />
            Lock the Room
          {/if}
        </DropdownMenu.Item>
        {#if spotlighted}
          <!-- Offered only while somebody is on every screen: an item that clears nothing is an
               item that teaches a reader the menu does not mean what it says. -->
          <DropdownMenu.Item onSelect={() => onClearSpotlight?.()}>
            <Focus class="size-16 shrink-0" aria-hidden="true" />
            Stop Spotlighting
          </DropdownMenu.Item>
        {/if}
        <DropdownMenu.Separator />
        <DropdownMenu.Item onSelect={() => onOpenHosts?.()}>
          <ShieldUser class="size-16 shrink-0" aria-hidden="true" />
          Hosts
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  {/if}

  <Button variant="destructive" onclick={onLeave}>
    <PhoneOff class="size-16" aria-hidden="true" />
    Leave
  </Button>

  {#if canEnd && onEnd !== undefined}
    <Button variant="secondary" onclick={() => (ending = true)}>
      <Square class="size-16" aria-hidden="true" />
      {endLabel}
    </Button>
  {/if}
</div>

{#if canEnd && onEnd !== undefined}
  <ActionDialog
    bind:open={ending}
    kind="destructive"
    heading={endLabel}
    {subtitle}
    commitLabel={endLabel}
    commitBusyLabel="Ending"
    unsavedChanges={false}
    onCommit={onEnd}
  >
    {#snippet notice()}
      {@render endFailure?.()}
    {/snippet}

    {#snippet fields()}
      <p class="text-sm">
        Everybody is taken out of the room and the {roomNoun} closes. The record keeps who was in
        it and for how long.
      </p>
    {/snippet}
  </ActionDialog>
{/if}
