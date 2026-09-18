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
   * LEAVING AND ENDING ARE DIFFERENT ACTS AND LOOK IT. Leaving takes this member out of the room;
   * ending closes it for everybody and is the host's alone, so it is asked for behind the one panel
   * the product asks acts in. Only one of the two wears the loud register, because a band with two
   * red controls tells a reader nothing about which one is the dangerous one.
   */
  import Mic from "@lucide/svelte/icons/mic";
  import MicOff from "@lucide/svelte/icons/mic-off";
  import PhoneOff from "@lucide/svelte/icons/phone-off";
  import ScreenShare from "@lucide/svelte/icons/screen-share";
  import ScreenShareOff from "@lucide/svelte/icons/screen-share-off";
  import Square from "@lucide/svelte/icons/square";
  import Video from "@lucide/svelte/icons/video";
  import VideoOff from "@lucide/svelte/icons/video-off";
  import Button from "@magna-carta/design-system/button";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import type { Snippet } from "svelte";

  let {
    microphoneOn,
    cameraOn,
    sharing,
    canEnd = false,
    subtitle = {},
    onToggleMicrophone,
    onToggleCamera,
    onToggleSharing,
    onLeave,
    onEnd,
    endFailure,
  }: {
    microphoneOn: boolean;
    cameraOn: boolean;
    sharing: boolean;
    /** Whether this member may end the meeting for everybody. */
    canEnd?: boolean;
    /** Which meeting is being ended, for the confirmation panel to name. */
    subtitle?: RecordSubject;
    onToggleMicrophone: () => void;
    onToggleCamera: () => void;
    onToggleSharing: () => void;
    onLeave: () => void;
    /** Ends it for everybody. Reports how the write went, so the panel can stand its ground. */
    onEnd?: () => Promise<ActionOutcome>;
    /** A failed end, in the app's own words, rendered in the panel's reserved band. */
    endFailure?: Snippet;
  } = $props();

  let ending = $state(false);
</script>

<div class="flex flex-wrap items-center gap-8" role="group" aria-label="Meeting controls">
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

  <Button variant="destructive" onclick={onLeave}>
    <PhoneOff class="size-16" aria-hidden="true" />
    Leave
  </Button>

  {#if canEnd && onEnd !== undefined}
    <Button variant="secondary" onclick={() => (ending = true)}>
      <Square class="size-16" aria-hidden="true" />
      End Meeting
    </Button>
  {/if}
</div>

{#if canEnd && onEnd !== undefined}
  <ActionDialog
    bind:open={ending}
    kind="destructive"
    heading="End Meeting"
    {subtitle}
    commitLabel="End Meeting"
    commitBusyLabel="Ending"
    unsavedChanges={false}
    onCommit={onEnd}
  >
    {#snippet notice()}
      {@render endFailure?.()}
    {/snippet}

    {#snippet fields()}
      <p class="text-sm">
        Everybody is taken out of the room and the meeting closes. The record keeps who was in it
        and for how long.
      </p>
    {/snippet}
  </ActionDialog>
{/if}
