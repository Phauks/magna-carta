<script lang="ts">
  /*
   * One tile: somebody's picture, their name, and whether anything is coming through.
   *
   * A stream is a PROPERTY of the element, never an attribute, so nothing in markup can set it —
   * the effect below is the only way a media stream reaches a video element, and it clears the
   * property on the way out so a torn-down tile does not hold a track open.
   *
   * THE LOCAL PREVIEW IS MUTED, ALWAYS. Playing back your own microphone is an echo loop, and it
   * is loud. That is why `local` is a separate prop from the name: what it decides is playback,
   * not labelling.
   *
   * THE NAME STRIP IS CHROME, and it wears the chrome register rather than the canvas's. The strip
   * lies over a picture whose colours nothing can predict, so it needs a surface of its own; the
   * work happening in the tile is the picture, and the identity stays at its edge.
   */
  import MicOff from "@lucide/svelte/icons/mic-off";
  import UserRound from "@lucide/svelte/icons/user-round";
  import Badge from "@magna-carta/design-system/badge";

  let {
    stream = null,
    name,
    local = false,
    microphoneOff = false,
    class: className = "",
  }: {
    /** The media to show. Null before anything has been pulled for this participant. */
    stream?: MediaStream | null;
    /** Who this is, as the roster states them. */
    name: string;
    /** This browser's own preview, which plays silently so it cannot echo. */
    local?: boolean;
    /**
     * Their microphone is off. A stream carrying no audio track says the same thing on its own, so
     * either answer draws the mark. Null for a tile that is not a person at all — a screen share,
     * which has no microphone to report and must not read as somebody sitting there muted.
     */
    microphoneOff?: boolean | null;
    class?: string;
  } = $props();

  let element = $state<HTMLVideoElement | null>(null);

  $effect(() => {
    const video = element;
    const source = stream;
    if (video === null) return;
    video.srcObject = source;
    return () => {
      video.srcObject = null;
    };
  });

  const silent = $derived(
    microphoneOff === true ||
      (microphoneOff !== null && stream !== null && stream.getAudioTracks().length === 0),
  );
  const showsPicture = $derived(stream !== null && stream.getVideoTracks().length > 0);
</script>

<figure
  class="relative flex min-h-0 min-w-0 overflow-hidden rounded-lg border border-border-default bg-surface-sunken {className}"
>
  <!-- svelte-ignore a11y_media_has_caption -->
  <!-- A live camera has no caption track to offer: nothing is transcribing the room in this slice,
       and an empty track element would assert captions that do not exist. -->
  <video
    bind:this={element}
    class="h-full w-full object-cover"
    autoplay
    playsinline
    muted={local}
  ></video>

  {#if !showsPicture}
    <!-- The tile keeps its shape whether or not a picture has arrived; absence is what says the
         camera is off, and the glyph is there so the tile is not a blank rectangle. -->
    <div class="absolute inset-0 flex items-center justify-center">
      <UserRound class="size-48 text-text-subtle" aria-hidden="true" />
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
  </figcaption>
</figure>
