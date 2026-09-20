<script lang="ts">
  /*
   * One tile: somebody's picture, their name, and whether anything is coming through.
   *
   * A stream is a PROPERTY of the element, never an attribute, so nothing in markup can set it —
   * the effect below is the only way a media stream reaches a video element, and it clears the
   * property on the way out so a torn-down tile does not hold a track open.
   *
   * NO TILE PLAYS SOUND. The people you HEAR are not the people you SEE in a room of any size —
   * whoever speaks from page four is pulled and played while their tile is nowhere on screen — so
   * every voice is played once, in one place (meeting-audio.svelte), and the video element here is
   * muted whoever it belongs to. A tile that played its own stream would also play this browser's
   * own microphone back at it, which is an echo loop, and it is loud.
   *
   * A TILE WITH NO PULLED PICTURE SAYS SO, AND DOES NOT PRETEND TO LOAD. Sixteen cameras is the
   * cap, so in a large room most people are a name and their initials — that is the ordinary state
   * of the room, not a failure and not a wait, and a spinner would say the opposite of both.
   *
   * THE NAME STRIP IS CHROME, and it wears the chrome register rather than the canvas's. The strip
   * lies over a picture whose colours nothing can predict, so it needs a surface of its own; the
   * work happening in the tile is the picture, and the identity stays at its edge.
   */
  import MicOff from "@lucide/svelte/icons/mic-off";
  import Pin from "@lucide/svelte/icons/pin";
  import PinOff from "@lucide/svelte/icons/pin-off";
  import UserRound from "@lucide/svelte/icons/user-round";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as Avatar from "@magna-carta/design-system/avatar";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import { participantInitials } from "./meeting-tiles.ts";
  import type { MeetingMedium } from "./meeting-client.svelte.ts";

  let {
    stream = null,
    name,
    microphoneOff = false,
    medium = "video",
    speaking = false,
    pinned = false,
    videoPulled = true,
    onPin,
    class: className = "",
  }: {
    /** The media to show. Null before anything has been pulled for this participant. */
    stream?: MediaStream | null;
    /** Who this is, as the roster states them. */
    name: string;
    /**
     * Their microphone is off. A stream carrying no audio track says the same thing on its own, so
     * either answer draws the mark. Null for a tile that is not a person at all — a screen share,
     * which has no microphone to report and must not read as somebody sitting there muted.
     */
    microphoneOff?: boolean | null;
    /**
     * What the room carries. A call has no picture in it at all, so the tile is the person's
     * initials and their name, and their voice is played elsewhere.
     */
    medium?: MeetingMedium;
    /** Their microphone is carrying speech right now, which is what the edge mark states. */
    speaking?: boolean;
    /** This member is holding them on screen. */
    pinned?: boolean;
    /** Whether this browser asked for their camera. False draws the name tile rather than a wait. */
    videoPulled?: boolean;
    /** Offered on a person's tile; a screen share has nobody to pin. */
    onPin?: () => void;
    class?: string;
  } = $props();

  /** The element the picture is played through. There is none where no picture was asked for. */
  let element = $state<HTMLVideoElement | null>(null);

  $effect(() => {
    const media = element;
    const source = stream;
    if (media === null) return;
    media.srcObject = source;
    return () => {
      media.srcObject = null;
    };
  });

  const silent = $derived(
    microphoneOff === true ||
      (microphoneOff !== null && stream !== null && stream.getAudioTracks().length === 0),
  );
  /** Whether a picture was asked for at all: a call has none, and most of a large room has none. */
  const drawsPicture = $derived(medium === "video" && videoPulled);
  const showsPicture = $derived(
    drawsPicture && stream !== null && stream.getVideoTracks().length > 0,
  );
</script>

<figure
  data-speaking={speaking ? "true" : undefined}
  data-pinned={pinned ? "true" : undefined}
  class="relative flex min-h-0 min-w-0 overflow-hidden rounded-lg border bg-surface-sunken {speaking
    ? 'border-accent-default'
    : 'border-border-default'} {className}"
>
  {#if drawsPicture}
    <!-- svelte-ignore a11y_media_has_caption -->
    <!-- A live camera has no caption track to offer: nothing is transcribing the room in this slice,
         and an empty track element would assert captions that do not exist. Muted whoever it
         belongs to — every voice in the room is played once, elsewhere. -->
    <video bind:this={element} class="h-full w-full object-cover" autoplay playsinline muted
    ></video>

    {#if !showsPicture}
      <!-- The tile keeps its shape whether or not a picture has arrived; absence is what says the
           camera is off, and the glyph is there so the tile is not a blank rectangle. -->
      <div class="absolute inset-0 flex items-center justify-center">
        <UserRound class="size-48 text-text-subtle" aria-hidden="true" />
      </div>
    {/if}
  {:else}
    <div class="absolute inset-0 flex flex-col items-center justify-center gap-8">
      <Avatar.Root>
        <Avatar.Fallback>{participantInitials(name)}</Avatar.Fallback>
      </Avatar.Root>
      {#if medium === "video"}
        <span class="text-xs text-text-muted">Not shown</span>
      {/if}
    </div>
  {/if}

  <figcaption
    class="absolute inset-x-0 bottom-0 flex items-center gap-8 bg-chrome-surface px-12 py-8"
  >
    <span class="min-w-0 flex-1 truncate text-sm text-chrome-text" title={name}>{name}</span>
    {#if silent}
      <Badge variant="neutral">
        <MicOff class="size-12" aria-hidden="true" />
        Muted
      </Badge>
    {/if}
    {#if onPin !== undefined}
      <!-- The glyph carries the state, so the control is not also ringed as a pressed toggle: a pin
           that has turned into an unpin has already said which side it is on. -->
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon"
              aria-label={pinned ? `Unpin ${name}` : `Pin ${name}`}
              onclick={onPin}
            >
              {#if pinned}
                <PinOff class="size-16" aria-hidden="true" />
              {:else}
                <Pin class="size-16" aria-hidden="true" />
              {/if}
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">{pinned ? "Unpin" : "Keep on screen"}</Tooltip.Content>
      </Tooltip.Root>
    {/if}
  </figcaption>
</figure>
