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
   * WHAT IS PULLED IS NOT WHAT IS MUTED, and the mark is never inferred from the stream. A browser
   * pulls sound for the people who have been talking and pictures for the people on this page, and
   * the two lists are ranked differently on purpose — so a colleague drawn here with their camera
   * coming in and their microphone not is perfectly ordinary, and their stream carries no audio
   * track. Reading that absence as "Muted" tells the room somebody is silent who is not, which is
   * the one thing a mute mark must never get wrong. Whether a microphone is off is a fact the
   * ROSTER states, and `meeting-tiles.ts` is where it is worked out.
   *
   * THE NAME STRIP IS CHROME, and it wears the chrome register rather than the canvas's. The strip
   * lies over a picture whose colours nothing can predict, so it needs a surface of its own; the
   * work happening in the tile is the picture, and the identity stays at its edge.
   */
  import AudioLines from "@lucide/svelte/icons/audio-lines";
  import Focus from "@lucide/svelte/icons/focus";
  import Hand from "@lucide/svelte/icons/hand";
  import MicOff from "@lucide/svelte/icons/mic-off";
  import Pin from "@lucide/svelte/icons/pin";
  import PinOff from "@lucide/svelte/icons/pin-off";
  import UserRound from "@lucide/svelte/icons/user-round";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as Avatar from "@magna-carta/design-system/avatar";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import MeetingQualityMark from "./meeting-quality-mark.svelte";
  import MeetingReactionMark from "./meeting-reaction-mark.svelte";
  import { HAND_RAISED_LABEL } from "./meeting-host-labels.ts";
  import { participantInitials } from "./meeting-tiles.ts";
  import type { ShownReaction } from "$lib/meetings/client/reactions.svelte.ts";
  import { hostRoleLabel, SPOTLIGHT_LABEL } from "./meeting-host-labels.ts";
  import type { ConnectionQuality } from "$lib/meetings/client/connection-quality.ts";
  import type { MeetingHostRole, MeetingMedium } from "@magna-carta/meeting-protocol/types";
  import type { Snippet } from "svelte";

  let {
    stream = null,
    name,
    microphoneOff = false,
    medium = "video",
    speaking = false,
    handRaised = false,
    reactions = [],
    pinned = false,
    videoPulled = true,
    quality = "unknown",
    hostRole = null,
    spotlighted = false,
    mirrored = false,
    fit = "cover",
    onPin,
    menu,
    class: className = "",
    style = undefined,
  }: {
    /** The media to show. Null before anything has been pulled for this participant. */
    stream?: MediaStream | null;
    /** Who this is, as the roster states them. */
    name: string;
    /**
     * Their microphone is off, as the roster states it. It is the ONLY thing that draws the mark —
     * the stream is not consulted, because a voice this browser has not pulled is not a voice that
     * has been turned off. Null for a tile that is not a person at all — a screen share, which has
     * no microphone to report and must not read as somebody sitting there muted.
     */
    microphoneOff?: boolean | null;
    /**
     * What the room carries. A call has no picture in it at all, so the tile is the person's
     * initials and their name, and their voice is played elsewhere.
     */
    medium?: MeetingMedium;
    /** Their microphone is carrying speech right now, which is what the edge mark states. */
    speaking?: boolean;
    /**
     * Their hand is up. Drawn on the strip beside the other marks rather than over the picture:
     * a mark laid on a face is a mark over whatever the camera happens to be showing, and the
     * strip is the one part of a tile whose surface this product paints.
     */
    handRaised?: boolean;
    /**
     * What is rising off this tile right now: what somebody threw, for as long as it is worth
     * looking at. Empty for almost every tile almost always.
     */
    reactions?: readonly ShownReaction[];
    /** This member is holding them on screen. */
    pinned?: boolean;
    /** Whether this browser asked for their camera. False draws the name tile rather than a wait. */
    videoPulled?: boolean;
    /**
     * How well their media is getting through, measured on this browser's own connection. It is the
     * answer to the question a member asks when a tile stutters — is it them or is it me — and the
     * local preview carries it too, because the answer is often "me".
     */
    quality?: ConnectionQuality;
    /**
     * Whether this person is running the meeting, and in which of the two ways.
     *
     * The badge is drawn for EVERYBODY, not only for a host reading the room: a member looking for
     * whoever to ask for the floor should not have to open a menu they do not have.
     */
    hostRole?: MeetingHostRole | null;
    /** A host has put them on every screen in the room. */
    spotlighted?: boolean;
    /**
     * Draw the picture flipped, as a mirror shows it. Only ever this browser's own camera preview,
     * at the member's choice: what the room receives is the camera's own picture either way.
     */
    mirrored?: boolean;
    /**
     * How the picture meets the tile. A face is cropped to fill it (`cover`); a shared screen is
     * shown whole (`contain`), because a cropped spreadsheet is a spreadsheet with columns missing.
     */
    fit?: "cover" | "contain";
    /** Offered on a person's tile; a screen share has nobody to pin. */
    onPin?: () => void;
    /**
     * The host's own menu for this person, where the member reading is running the meeting. Absent
     * for everybody else — not disabled, because for a member who is not hosting it could not
     * happen here at all.
     */
    menu?: Snippet;
    class?: string;
    /** The size the gallery worked out for this tile, where it worked one out. */
    style?: string;
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

  /** Whether the mute mark is drawn. The roster's answer, and nothing the stream implies. */
  const silent = $derived(microphoneOff === true);
  /** Whether a picture was asked for at all: a call has none, and most of a large room has none. */
  const drawsPicture = $derived(medium === "video" && videoPulled);
  const showsPicture = $derived(
    drawsPicture && stream !== null && stream.getVideoTracks().length > 0,
  );
</script>

<figure
  data-speaking={speaking ? "true" : undefined}
  data-pinned={pinned ? "true" : undefined}
  data-spotlighted={spotlighted ? "true" : undefined}
  class="relative flex min-h-0 min-w-0 overflow-hidden rounded-lg border bg-surface-sunken {speaking
    ? 'border-accent-default outline-2 -outline-offset-2 outline-accent-default'
    : 'border-border-default'} {className}"
  {style}
>
  {#if drawsPicture}
    <!-- svelte-ignore a11y_media_has_caption -->
    <!-- A live camera has no caption track to offer: nothing is transcribing the room in this slice,
         and an empty track element would assert captions that do not exist. Muted whoever it
         belongs to — every voice in the room is played once, elsewhere. -->
    <video
      bind:this={element}
      class="h-full w-full {fit === 'contain' ? 'object-contain' : 'object-cover'} {mirrored
        ? '-scale-x-100'
        : ''}"
      autoplay
      playsinline
      muted
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

  {#if reactions.length > 0}
    <!-- What was thrown, rising out of the tile. It sits above the name strip so a burst never
         covers the one thing the strip is for, and it takes no pointer: a reaction is something to
         look at rather than something to press. It is HIDDEN from a reader, because the room
         announces a reaction once, politely, in its own live region — a second voice per tile would
         read the same sentence again for every bubble on the screen. -->
    <div
      class="pointer-events-none absolute inset-x-0 bottom-40 flex items-end justify-center gap-8"
      aria-hidden="true"
    >
      {#each reactions as reaction (reaction.key)}
        <MeetingReactionMark name={reaction.name} rising />
      {/each}
    </div>
  {/if}

  <figcaption
    class="absolute inset-x-0 bottom-0 flex items-center gap-8 bg-chrome-surface px-12 py-8"
  >
    {#if speaking}
      <!-- Who is talking, said twice: the ring round the tile for a glance across the room, and this
           mark beside the name for a tile too small for the ring to stand out. -->
      <AudioLines class="size-16 shrink-0 text-accent-default" aria-label="Speaking" />
    {/if}
    <span class="min-w-0 flex-1 truncate text-sm text-chrome-text" title={name}>{name}</span>
    <MeetingQualityMark {quality} register="chrome" />
    {#if handRaised}
      <!-- A request for the floor, in the accent the room's other live marks wear. It leads the
           other marks because it is the one a host is scanning for. -->
      <Hand class="size-16 text-accent-default" aria-label={HAND_RAISED_LABEL} />
    {/if}
    {#if spotlighted}
      <!-- The one mark on the strip that says something about the ROOM rather than about this
           person: a host decided everybody is looking at them. -->
      <Focus class="size-16 text-accent-default" aria-label={SPOTLIGHT_LABEL} />
    {/if}
    {#if hostRole !== null}
      <Badge variant="neutral" caps>{hostRoleLabel(hostRole)}</Badge>
    {/if}
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
    {@render menu?.()}
  </figcaption>
</figure>
